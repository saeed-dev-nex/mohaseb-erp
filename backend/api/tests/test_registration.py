"""Self-service registration (license-gated) + account security tests.

Mail is captured by patching the accounts service's send function, so
tests read the plain one-time codes from the captured calls. CAPTCHA
verification is patched open except in the dedicated captcha and
progressive-login tests, which exercise the real mechanism.
"""

from unittest.mock import patch

from django.contrib.auth.models import User
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .. import captcha
from ..models import (
    Business, BusinessMembership, OneTimeCode, RegistrationCode,
)
from ..password_policy import password_failures
from ..services.accounts import (
    create_registration_codes, get_security_profile, hash_secret,
    issue_one_time_code,
)

GOOD_PASSWORD = 'Str0ng!Pass'
NEW_PASSWORD = 'N3w!Password'


class MailCapture:
    def __enter__(self):
        self.sent = []

        def record(email, code, purpose):
            self.sent.append({'email': email, 'code': code, 'purpose': purpose})
            return True

        self.patcher = patch(
            'api.services.accounts.send_one_time_code', side_effect=record,
        )
        self.patcher.start()
        return self

    def __exit__(self, *exc):
        self.patcher.stop()

    def code_for(self, purpose):
        matches = [item for item in self.sent if item['purpose'] == purpose]
        return matches[-1]['code'] if matches else None


class PasswordPolicyTests(TestCase):
    def test_good_password_passes(self):
        self.assertEqual(password_failures(GOOD_PASSWORD), [])

    def test_each_rule_is_reported(self):
        self.assertTrue(any('۸' in item or '8' in item for item in password_failures('Ab1!')))
        self.assertTrue(password_failures('alllowercase1!'))  # no upper
        self.assertTrue(password_failures('ALLUPPERCASE1!'))  # no lower
        self.assertTrue(password_failures('NoDigits!Here'))  # no digit
        self.assertTrue(password_failures('NoSpecial123'))  # no special


class CaptchaTests(TestCase):
    def test_challenge_roundtrip_and_one_shot(self):
        cache.set('captcha:fixed-id', captcha._hash('AB12'), 300)
        self.assertTrue(captcha.verify_challenge('fixed-id', 'ab12'))
        # Consumed: the same challenge cannot be replayed.
        self.assertFalse(captcha.verify_challenge('fixed-id', 'ab12'))

    def test_wrong_answer_consumes_challenge(self):
        cache.set('captcha:fixed-id2', captcha._hash('AB12'), 300)
        self.assertFalse(captcha.verify_challenge('fixed-id2', 'ZZ99'))
        self.assertFalse(captcha.verify_challenge('fixed-id2', 'AB12'))

    def test_new_challenge_shape(self):
        challenge_id, image = captcha.new_challenge()
        self.assertTrue(challenge_id)
        self.assertTrue(image.startswith('data:image/svg+xml;base64,'))


class RegistrationTestBase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_superuser(
            username='admin', email='admin@example.com',
            password='admin' + '-pass-12345',
        )
        captcha_patcher = patch('api.captcha.verify_challenge', return_value=True)
        captcha_patcher.start()
        self.addCleanup(captcha_patcher.stop)

    def generate_codes(self, count=1, **kwargs):
        self.client.force_authenticate(self.admin)
        response = self.client.post('/api/registration-codes/', {'count': count, **kwargs})
        self.client.force_authenticate(None)
        self.assertEqual(response.status_code, 201, response.content)
        return response.data['codes']

    def register(self, code, username='customer1', email='c1@example.com',
                 password=GOOD_PASSWORD):
        return self.client.post('/api/registration/register/', {
            'code': code, 'username': username, 'email': email,
            'password': password, 'captcha_id': 'x', 'captcha_answer': 'y',
        })


class RegistrationCodeAdminTests(RegistrationTestBase):
    def test_non_superuser_cannot_generate_or_list(self):
        plain = User.objects.create_user(username='plain', password='x')
        self.client.force_authenticate(plain)
        self.assertEqual(self.client.post('/api/registration-codes/', {'count': 1}).status_code, 403)
        self.assertEqual(self.client.get('/api/registration-codes/').status_code, 403)

    def test_generated_codes_are_stored_hashed(self):
        codes = self.generate_codes(2, note='مشتری الف')
        self.assertEqual(len(codes), 2)
        stored = RegistrationCode.objects.order_by('id').first()
        self.assertEqual(stored.code_hash, hash_secret(codes[0].replace('-', '')))
        self.assertEqual(stored.code_hint, codes[0][-4:])
        self.assertEqual(stored.status, 'available')
        self.assertEqual(stored.note, 'مشتری الف')

    def test_check_code_endpoint(self):
        code = self.generate_codes(1)[0]
        ok = self.client.post('/api/registration/check-code/', {'code': code})
        self.assertEqual(ok.status_code, 200)
        bad = self.client.post('/api/registration/check-code/', {'code': 'AAAA-BBBB-CCCC-DDDD'})
        self.assertEqual(bad.status_code, 400)

    def test_revoke_blocks_registration(self):
        code = self.generate_codes(1)[0]
        record = RegistrationCode.objects.get()
        self.client.force_authenticate(self.admin)
        response = self.client.post(f'/api/registration-codes/{record.id}/revoke/')
        self.client.force_authenticate(None)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.register(code).status_code, 400)


class RegistrationFlowTests(RegistrationTestBase):
    def test_full_flow_register_verify_login(self):
        code = self.generate_codes(1)[0]
        with MailCapture() as mail:
            response = self.register(code)
            self.assertEqual(response.status_code, 201, response.content)
            user = User.objects.get(username='customer1')
            self.assertFalse(user.is_active)
            stored = RegistrationCode.objects.get()
            self.assertEqual(stored.status, 'used')
            self.assertEqual(stored.used_by, user)
            # Login is refused before email verification.
            login = self.client.post('/api/token/', {
                'username': 'customer1', 'password': GOOD_PASSWORD,
            })
            self.assertEqual(login.status_code, 401)
            verify_code = mail.code_for('verify_email')
            self.assertTrue(verify_code)
            wrong = self.client.post('/api/registration/verify-email/', {
                'username': 'customer1', 'code': '000000',
            })
            self.assertEqual(wrong.status_code, 400)
            verified = self.client.post('/api/registration/verify-email/', {
                'username': 'customer1', 'code': verify_code,
            })
            self.assertEqual(verified.status_code, 200, verified.content)
        user.refresh_from_db()
        self.assertTrue(user.is_active)
        self.assertTrue(get_security_profile(user).email_verified)
        login = self.client.post('/api/token/', {
            'username': 'customer1', 'password': GOOD_PASSWORD,
        })
        self.assertEqual(login.status_code, 200, login.content)

    def test_code_cannot_be_reused(self):
        code = self.generate_codes(1)[0]
        with MailCapture():
            self.assertEqual(self.register(code).status_code, 201)
            second = self.register(code, username='other', email='o@example.com')
            self.assertEqual(second.status_code, 400)

    def test_weak_password_and_duplicates_rejected(self):
        code = self.generate_codes(1)[0]
        weak = self.register(code, password='weak')
        self.assertEqual(weak.status_code, 400)
        with MailCapture():
            self.assertEqual(self.register(code).status_code, 201)
            code2 = self.generate_codes(1)[0]
            duplicate = self.register(code2, username='customer1', email='new@example.com')
            self.assertEqual(duplicate.status_code, 400)
            duplicate_email = self.register(code2, username='someone', email='c1@example.com')
            self.assertEqual(duplicate_email.status_code, 400)

    def test_expired_code_rejected(self):
        codes = create_registration_codes(self.admin, 1, valid_days=-1)
        self.assertEqual(RegistrationCode.objects.get().status, 'expired')
        self.assertEqual(self.register(codes[0]).status_code, 400)


class FirstBusinessTests(RegistrationTestBase):
    def _verified_user(self, username='owner1'):
        code = self.generate_codes(1)[0]
        with MailCapture() as mail:
            self.register(code, username=username, email=f'{username}@example.com')
            self.client.post('/api/registration/verify-email/', {
                'username': username, 'code': mail.code_for('verify_email'),
            })
        return User.objects.get(username=username)

    def test_licensed_user_creates_first_business_only(self):
        user = self._verified_user()
        self.client.force_authenticate(user)
        created = self.client.post('/api/businesses/', {
            'name': 'فروشگاه من', 'template_key': 'retail',
            'person_type': 'individual',
        })
        self.assertEqual(created.status_code, 201, created.content)
        business = Business.objects.get(name='فروشگاه من')
        membership = BusinessMembership.objects.get(user=user, business=business)
        self.assertEqual(membership.role, 'owner')
        second = self.client.post('/api/businesses/', {
            'name': 'دوم', 'template_key': 'retail', 'person_type': 'individual',
        })
        self.assertEqual(second.status_code, 403)

    def test_unlicensed_user_cannot_create_business(self):
        plain = User.objects.create_user(username='plain2', password='x')
        self.client.force_authenticate(plain)
        response = self.client.post('/api/businesses/', {
            'name': 'بدون مجوز', 'template_key': 'retail',
            'person_type': 'individual',
        })
        self.assertEqual(response.status_code, 403)


class RecoveryAndOtpTests(RegistrationTestBase):
    def setUp(self):
        super().setUp()
        self.user = User.objects.create_user(
            username='member', email='member@example.com',
            password=GOOD_PASSWORD,
        )

    def test_forgot_and_reset_password(self):
        with MailCapture() as mail:
            response = self.client.post('/api/auth/forgot-password/', {
                'identifier': 'member@example.com',
                'captcha_id': 'x', 'captcha_answer': 'y',
            })
            self.assertEqual(response.status_code, 200)
            code = mail.code_for('password_reset')
            self.assertTrue(code)
            weak = self.client.post('/api/auth/reset-password/', {
                'identifier': 'member', 'code': code, 'new_password': 'weak',
            })
            self.assertEqual(weak.status_code, 400)
            done = self.client.post('/api/auth/reset-password/', {
                'identifier': 'member', 'code': code, 'new_password': NEW_PASSWORD,
            })
            self.assertEqual(done.status_code, 200, done.content)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(NEW_PASSWORD))
        self.assertFalse(self.user.check_password(GOOD_PASSWORD))

    def test_forgot_password_does_not_enumerate(self):
        with MailCapture() as mail:
            response = self.client.post('/api/auth/forgot-password/', {
                'identifier': 'ghost@example.com',
                'captcha_id': 'x', 'captcha_answer': 'y',
            })
            self.assertEqual(response.status_code, 200)
            self.assertIsNone(mail.code_for('password_reset'))

    def test_login_otp_flow(self):
        with MailCapture() as mail:
            self.client.post('/api/auth/otp/request/', {'identifier': 'member'})
            code = mail.code_for('login_otp')
            self.assertTrue(code)
            wrong = self.client.post('/api/auth/otp/verify/', {
                'identifier': 'member', 'code': '000000',
            })
            self.assertEqual(wrong.status_code, 400)
            ok = self.client.post('/api/auth/otp/verify/', {
                'identifier': 'member', 'code': code,
            })
            self.assertEqual(ok.status_code, 200, ok.content)
            self.assertIn('access', ok.data)

    def test_otp_attempts_are_capped(self):
        with MailCapture() as mail:
            self.client.post('/api/auth/otp/request/', {'identifier': 'member'})
            code = mail.code_for('login_otp')
            for _ in range(5):
                self.client.post('/api/auth/otp/verify/', {
                    'identifier': 'member', 'code': '000000',
                })
            blocked = self.client.post('/api/auth/otp/verify/', {
                'identifier': 'member', 'code': code,
            })
            self.assertEqual(blocked.status_code, 400)


class ChangePasswordAndAgeTests(RegistrationTestBase):
    def setUp(self):
        super().setUp()
        self.user = User.objects.create_user(
            username='ager', email='ager@example.com', password=GOOD_PASSWORD,
        )
        self.client.force_authenticate(self.user)

    def test_me_reports_password_age(self):
        profile = get_security_profile(self.user)
        profile.password_changed_at = timezone.now() - timezone.timedelta(days=120)
        profile.save(update_fields=['password_changed_at'])
        data = self.client.get('/api/users/me/').data
        self.assertTrue(data['password_change_due'])
        self.assertGreaterEqual(data['password_age_days'], 119)

    def test_change_password_flow(self):
        wrong = self.client.post('/api/auth/change-password/', {
            'current_password': 'nope', 'new_password': NEW_PASSWORD,
        })
        self.assertEqual(wrong.status_code, 400)
        weak = self.client.post('/api/auth/change-password/', {
            'current_password': GOOD_PASSWORD, 'new_password': 'weak',
        })
        self.assertEqual(weak.status_code, 400)
        done = self.client.post('/api/auth/change-password/', {
            'current_password': GOOD_PASSWORD, 'new_password': NEW_PASSWORD,
        })
        self.assertEqual(done.status_code, 200, done.content)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(NEW_PASSWORD))
        data = self.client.get('/api/users/me/').data
        self.assertFalse(data['password_change_due'])


class ProgressiveCaptchaLoginTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        cache.clear()
        # Leave no throttle/failure debt behind for other test classes:
        # they share this process-wide cache.
        self.addCleanup(cache.clear)
        self.user = User.objects.create_user(
            username='victim', email='v@example.com', password=GOOD_PASSWORD,
        )

    def login(self, password, **extra):
        return self.client.post('/api/token/', {
            'username': 'victim', 'password': password, **extra,
        })

    def test_captcha_kicks_in_after_two_failures(self):
        first = self.login('wrong-1')
        self.assertEqual(first.status_code, 401)
        second = self.login('wrong-2')
        self.assertEqual(second.status_code, 401)
        # From the third attempt on, a captcha is demanded up front —
        # even the right password is refused without one.
        blocked = self.login(GOOD_PASSWORD)
        self.assertEqual(blocked.status_code, 400)
        self.assertTrue(blocked.data.get('captcha_required'))
        with patch('api.captcha.verify_challenge', return_value=True):
            ok = self.login(GOOD_PASSWORD, captcha_id='x', captcha_answer='y')
        self.assertEqual(ok.status_code, 200, ok.content)
        # Success cleared the counter: the next failure is a plain 401.
        again = self.login('wrong-again')
        self.assertEqual(again.status_code, 401)


class OneTimeCodeServiceTests(TestCase):
    def test_issue_invalidates_previous_codes(self):
        user = User.objects.create_user(
            username='svc', email='svc@example.com', password='x',
        )
        with MailCapture() as mail:
            issue_one_time_code(user, 'login_otp')
            first_code = mail.code_for('login_otp')
            issue_one_time_code(user, 'login_otp')
            second_code = mail.code_for('login_otp')
        from ..services.accounts import verify_one_time_code

        self.assertNotEqual(first_code, second_code)
        self.assertFalse(verify_one_time_code(user, 'login_otp', first_code))
        self.assertTrue(verify_one_time_code(user, 'login_otp', second_code))
        self.assertEqual(
            OneTimeCode.objects.filter(user=user, purpose='login_otp').count(), 2,
        )
