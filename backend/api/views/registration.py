"""Self-service registration (license-gated) + account security endpoints.

The platform owner issues one-time registration codes; a customer
registers with a code, verifies their email with a one-time code,
and only then can sign in and create their (first) business.
Recovery (forgot password) and quick login also run on emailed
one-time codes. Passwords set here must satisfy the complexity
policy in api/password_policy.py.
"""

from django.contrib.auth.models import User
from django.db import transaction
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .. import captcha
from ..auth_views import _is_web_client, _set_refresh_cookie
from ..models import RegistrationCode
from ..password_policy import validate_password_complexity
from ..serializers import RegistrationCodeSerializer
from ..services.accounts import (
    create_registration_codes, find_registration_code,
    find_user_for_recovery, get_security_profile, issue_one_time_code,
    mark_password_changed, revoke_all_sessions, verify_one_time_code,
)
from .common import IsSuperuser

PUBLIC_THROTTLE = dict(
    throttle_classes=[ScopedRateThrottle], throttle_scope='registration',
)


def _captcha_ok(request):
    return captcha.verify_challenge(
        request.data.get('captcha_id'), request.data.get('captcha_answer'),
    )


def _captcha_error():
    return Response(
        {'detail': 'کپچا نادرست است؛ تصویر تازه بگیرید و دوباره تلاش کنید.',
         'captcha_required': True},
        status=status.HTTP_400_BAD_REQUEST,
    )


class CaptchaView(APIView):
    """GET /api/auth/captcha/ — a fresh built-in image challenge."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        challenge_id, image = captcha.new_challenge()
        return Response({'id': challenge_id, 'image': image})


class RegistrationCodeViewSet(viewsets.ModelViewSet):
    """Superuser-only management of one-time registration codes."""

    serializer_class = RegistrationCodeSerializer
    permission_classes = [IsSuperuser]
    http_method_names = ['get', 'post', 'head', 'options']

    def get_queryset(self):
        return RegistrationCode.objects.select_related('created_by', 'used_by').all()

    def create(self, request, *args, **kwargs):
        try:
            count = int(request.data.get('count') or 1)
        except (TypeError, ValueError):
            raise ValidationError({'count': 'تعداد باید عدد باشد.'})
        if not 1 <= count <= 50:
            raise ValidationError({'count': 'تعداد باید بین ۱ تا ۵۰ باشد.'})
        valid_days = request.data.get('valid_days')
        try:
            valid_days = int(valid_days) if valid_days else None
        except (TypeError, ValueError):
            raise ValidationError({'valid_days': 'مهلت باید عدد (روز) باشد.'})
        codes = create_registration_codes(
            created_by=request.user,
            count=count,
            note=str(request.data.get('note') or '')[:200],
            valid_days=valid_days,
        )
        # The plain codes exist only in this response — only hashes
        # are stored — so the UI must show/copy them now.
        return Response({'codes': codes}, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path='revoke')
    def revoke(self, request, pk=None):
        code = self.get_object()
        if code.used_at is not None:
            raise ValidationError('این کد مصرف شده و قابل ابطال نیست.')
        code.revoked = True
        code.save(update_fields=['revoked'])
        return Response(self.get_serializer(code).data)


class CheckRegistrationCodeView(APIView):
    """POST /api/registration/check-code/ — step 1 of signup."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = PUBLIC_THROTTLE['throttle_classes']
    throttle_scope = PUBLIC_THROTTLE['throttle_scope']

    def post(self, request):
        code = find_registration_code(request.data.get('code'))
        if code is None or code.status != 'available':
            return Response(
                {'valid': False, 'detail': 'کد مجوز معتبر نیست، مصرف شده یا منقضی است.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response({'valid': True})


class RegisterView(APIView):
    """POST /api/registration/register/ — create an inactive account."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = PUBLIC_THROTTLE['throttle_classes']
    throttle_scope = PUBLIC_THROTTLE['throttle_scope']

    def post(self, request):
        if not _captcha_ok(request):
            return _captcha_error()
        username = str(request.data.get('username') or '').strip()
        email = str(request.data.get('email') or '').strip().lower()
        password = str(request.data.get('password') or '')
        first_name = str(request.data.get('first_name') or '').strip()
        last_name = str(request.data.get('last_name') or '').strip()
        if not username:
            raise ValidationError({'username': 'نام کاربری الزامی است.'})
        if not email or '@' not in email:
            raise ValidationError({'email': 'ایمیل معتبر وارد کنید.'})
        validate_password_complexity(password)
        if User.objects.filter(username__iexact=username).exists():
            raise ValidationError({'username': 'این نام کاربری قبلاً گرفته شده است.'})
        if User.objects.filter(email__iexact=email).exists():
            raise ValidationError({'email': 'با این ایمیل قبلاً حساب ساخته شده است.'})
        with transaction.atomic():
            code = (
                RegistrationCode.objects.select_for_update()
                .filter(id=getattr(find_registration_code(request.data.get('code')), 'id', None))
                .first()
            )
            if code is None or code.status != 'available':
                return Response(
                    {'detail': 'کد مجوز معتبر نیست، مصرف شده یا منقضی است.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            user = User.objects.create_user(
                username, email, password,
                first_name=first_name, last_name=last_name,
                is_active=False,
            )
            code.used_at = timezone.now()
            code.used_by = user
            code.save(update_fields=['used_at', 'used_by'])
            get_security_profile(user)
            issue_one_time_code(user, 'verify_email')
        return Response(
            {'registered': True, 'username': user.username,
             'detail': 'حساب ساخته شد؛ کد تأیید به ایمیل‌تان ارسال شد.'},
            status=status.HTTP_201_CREATED,
        )


class VerifyEmailView(APIView):
    """POST /api/registration/verify-email/ — activate the account."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = PUBLIC_THROTTLE['throttle_classes']
    throttle_scope = PUBLIC_THROTTLE['throttle_scope']

    def post(self, request):
        username = str(request.data.get('username') or '').strip()
        user = User.objects.filter(username__iexact=username).first()
        if user is None or user.is_active:
            return Response(
                {'detail': 'حساب یافت نشد یا قبلاً فعال شده است.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not verify_one_time_code(user, 'verify_email', request.data.get('code')):
            return Response(
                {'detail': 'کد تأیید نادرست یا منقضی است.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user.is_active = True
        user.save(update_fields=['is_active'])
        profile = get_security_profile(user)
        profile.email_verified = True
        profile.save(update_fields=['email_verified'])
        return Response({'verified': True, 'detail': 'حساب فعال شد؛ حالا می‌توانید وارد شوید.'})


class ResendVerificationView(APIView):
    """POST /api/registration/resend-code/ — a fresh activation code."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = PUBLIC_THROTTLE['throttle_classes']
    throttle_scope = PUBLIC_THROTTLE['throttle_scope']

    def post(self, request):
        username = str(request.data.get('username') or '').strip()
        user = User.objects.filter(username__iexact=username, is_active=False).first()
        if user is not None:
            issue_one_time_code(user, 'verify_email')
        # Generic answer either way: no account enumeration.
        return Response({'sent': True, 'detail': 'اگر حسابی در انتظار فعال‌سازی باشد، کد تازه ارسال شد.'})


class ForgotPasswordView(APIView):
    """POST /api/auth/forgot-password/ — send a reset code."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = PUBLIC_THROTTLE['throttle_classes']
    throttle_scope = PUBLIC_THROTTLE['throttle_scope']

    def post(self, request):
        if not _captcha_ok(request):
            return _captcha_error()
        user = find_user_for_recovery(request.data.get('identifier'))
        if user is not None and user.email:
            issue_one_time_code(user, 'password_reset')
        return Response(
            {'sent': True,
             'detail': 'اگر حسابی با این مشخصات وجود داشته باشد، کد بازیابی به ایمیل آن ارسال شد.'},
        )


class ResetPasswordView(APIView):
    """POST /api/auth/reset-password/ — code + new password."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = PUBLIC_THROTTLE['throttle_classes']
    throttle_scope = PUBLIC_THROTTLE['throttle_scope']

    def post(self, request):
        user = find_user_for_recovery(request.data.get('identifier'))
        if user is None:
            return Response(
                {'detail': 'کد بازیابی نادرست یا منقضی است.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        new_password = str(request.data.get('new_password') or '')
        validate_password_complexity(new_password)
        if not verify_one_time_code(user, 'password_reset', request.data.get('code')):
            return Response(
                {'detail': 'کد بازیابی نادرست یا منقضی است.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user.set_password(new_password)
        user.save(update_fields=['password'])
        mark_password_changed(user)
        profile = get_security_profile(user)
        if not profile.email_verified:
            profile.email_verified = True
            profile.save(update_fields=['email_verified'])
        revoke_all_sessions(user)
        return Response({'reset': True, 'detail': 'رمز عبور تازه ثبت شد؛ با آن وارد شوید.'})


class LoginOtpRequestView(APIView):
    """POST /api/auth/otp/request/ — email a quick-login code."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = PUBLIC_THROTTLE['throttle_classes']
    throttle_scope = PUBLIC_THROTTLE['throttle_scope']

    def post(self, request):
        user = find_user_for_recovery(request.data.get('identifier'))
        if user is not None and user.email:
            issue_one_time_code(user, 'login_otp')
        return Response(
            {'sent': True,
             'detail': 'اگر حسابی با این مشخصات وجود داشته باشد، کد ورود به ایمیل آن ارسال شد.'},
        )


class LoginOtpVerifyView(APIView):
    """POST /api/auth/otp/verify/ — exchange a login code for tokens."""

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = PUBLIC_THROTTLE['throttle_classes']
    throttle_scope = PUBLIC_THROTTLE['throttle_scope']

    def post(self, request):
        user = find_user_for_recovery(request.data.get('identifier'))
        if user is None or not verify_one_time_code(user, 'login_otp', request.data.get('code')):
            return Response(
                {'detail': 'کد ورود نادرست یا منقضی است.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        from rest_framework_simplejwt.tokens import RefreshToken

        user.last_login = timezone.now()
        user.save(update_fields=['last_login'])
        refresh = RefreshToken.for_user(user)
        data = {'access': str(refresh.access_token), 'refresh': str(refresh)}
        response = Response(data)
        _set_refresh_cookie(request, response, data['refresh'])
        if _is_web_client(request):
            response.data.pop('refresh', None)
        return response


class ChangePasswordView(APIView):
    """POST /api/auth/change-password/ — signed-in password change."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user
        current = str(request.data.get('current_password') or '')
        new_password = str(request.data.get('new_password') or '')
        if not user.check_password(current):
            return Response(
                {'detail': 'رمز فعلی نادرست است.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        validate_password_complexity(new_password)
        user.set_password(new_password)
        user.save(update_fields=['password'])
        mark_password_changed(user)
        # Every other session dies; the caller stays signed in.
        revoke_all_sessions(user)
        from rest_framework_simplejwt.tokens import RefreshToken

        refresh = RefreshToken.for_user(user)
        data = {'access': str(refresh.access_token), 'refresh': str(refresh)}
        response = Response({'changed': True, **data})
        _set_refresh_cookie(request, response, data['refresh'])
        if _is_web_client(request):
            response.data.pop('refresh', None)
        return response
