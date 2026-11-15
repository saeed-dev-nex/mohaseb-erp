"""Phase 2.7: product category trees (گروه ← نوع ← برند) per business."""

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from ..models import Business, BusinessMembership, Product, ProductCategory

User = get_user_model()
PW = 'member' + '-pass-12345'


class CategoryBase(TestCase):
    def setUp(self):
        cache.clear()
        self.admin = User.objects.create_superuser(
            username='cat-admin', password='admin' + '-pass-12345',
        )
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            '/api/businesses/',
            {'name': 'سوپرمارکت دسته‌ها', 'template_key': 'retail', 'person_type': 'individual'},
            format='json',
        )
        assert response.status_code == 201, response.content
        self.shop = Business.objects.get(name='سوپرمارکت دسته‌ها')
        self.headers = {'HTTP_X_BUSINESS_ID': str(self.shop.id)}
        # Most tests build their own tree; the seeded starter tree is
        # covered by its own test on a fresh business.
        ProductCategory.objects.filter(business=self.shop).delete()

    def create_category(self, name, parent=None, headers=None):
        payload = {'name': name}
        if parent is not None:
            payload['parent'] = parent
        return self.client.post(
            '/api/product-categories/', payload, format='json',
            **(headers or self.headers),
        )

    def make_tree(self):
        root = self.create_category('نوشیدنی‌ها').data
        mid = self.create_category('نوشابه گازدار', parent=root['id']).data
        leaf = self.create_category('کوکاکولا', parent=mid['id']).data
        return root, mid, leaf


class CategoryTreeTests(CategoryBase):
    def test_business_creation_seeds_the_trade_tree(self):
        response = self.client.post(
            '/api/businesses/',
            {'name': 'فروشگاه تازه', 'template_key': 'retail', 'person_type': 'individual'},
            format='json',
        )
        assert response.status_code == 201, response.content
        fresh = Business.objects.get(name='فروشگاه تازه')
        names = set(
            ProductCategory.objects.filter(business=fresh)
            .values_list('name', flat=True)
        )
        self.assertIn('نوشیدنی‌ها', names)
        self.assertIn('نوشابه گازدار', names)
        self.assertIn('کوکاکولا', names)
        coke = ProductCategory.objects.get(business=fresh, name='کوکاکولا')
        self.assertEqual(coke.path, 'نوشیدنی‌ها ← نوشابه گازدار ← کوکاکولا')

    def test_create_tree_and_path(self):
        root, mid, leaf = self.make_tree()
        self.assertEqual(leaf['path'], 'نوشیدنی‌ها ← نوشابه گازدار ← کوکاکولا')
        listing = self.client.get(
            '/api/product-categories/', **self.headers,
        )
        by_name = {row['name']: row for row in listing.data}
        self.assertEqual(by_name['نوشیدنی‌ها']['children_count'], 1)
        self.assertEqual(by_name['نوشابه گازدار']['children_count'], 1)

    def test_duplicate_sibling_name_rejected(self):
        self.create_category('لبنیات')
        response = self.create_category('لبنیات')
        self.assertEqual(response.status_code, 400, response.content)

    def test_cycle_rejected(self):
        root, mid, leaf = self.make_tree()
        response = self.client.patch(
            f"/api/product-categories/{root['id']}/",
            {'parent': leaf['id']}, format='json', **self.headers,
        )
        self.assertEqual(response.status_code, 400, response.content)

    def test_delete_with_children_blocked_then_leaf_delete_nulls_product(self):
        root, mid, leaf = self.make_tree()
        response = self.client.delete(
            f"/api/product-categories/{root['id']}/", **self.headers,
        )
        self.assertEqual(response.status_code, 400, response.content)
        product = self.client.post(
            '/api/products/',
            {'name': 'نوشابه کوکاکولا ۱٫۵', 'category': leaf['id']},
            format='json', **self.headers,
        ).data
        response = self.client.delete(
            f"/api/product-categories/{leaf['id']}/", **self.headers,
        )
        self.assertEqual(response.status_code, 204, response.content)
        self.assertIsNone(Product.objects.get(id=product['id']).category)

    def test_seed_defaults_is_idempotent(self):
        first = self.client.post(
            '/api/product-categories/seed-defaults/', {}, format='json',
            **self.headers,
        )
        self.assertEqual(first.status_code, 200, first.content)
        self.assertGreater(first.data['created'], 0)
        total = ProductCategory.objects.filter(business=self.shop).count()
        second = self.client.post(
            '/api/product-categories/seed-defaults/', {}, format='json',
            **self.headers,
        )
        self.assertEqual(second.data['created'], 0)
        self.assertEqual(
            ProductCategory.objects.filter(business=self.shop).count(), total,
        )


class CategoryProductTests(CategoryBase):
    def test_product_carries_category_path(self):
        root, mid, leaf = self.make_tree()
        response = self.client.post(
            '/api/products/',
            {'name': 'نوشابه کوکاکولا ۱٫۵', 'category': leaf['id']},
            format='json', **self.headers,
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.data['category_name'], 'کوکاکولا')
        self.assertEqual(
            response.data['category_path'],
            'نوشیدنی‌ها ← نوشابه گازدار ← کوکاکولا',
        )

    def test_category_filter_covers_the_subtree(self):
        root, mid, leaf = self.make_tree()
        other = self.create_category('لبنیات').data
        for name, category in (
            ('کالای برند', leaf['id']),
            ('کالای میانی', mid['id']),
            ('کالای دیگر', other['id']),
            ('بدون دسته', None),
        ):
            payload = {'name': name}
            if category:
                payload['category'] = category
            self.client.post(
                '/api/products/', payload, format='json', **self.headers,
            )
        response = self.client.get(
            f"/api/products/?category={root['id']}", **self.headers,
        )
        names = {row['name'] for row in response.data}
        self.assertEqual(names, {'کالای برند', 'کالای میانی'})

    def test_cross_business_category_rejected(self):
        other_shop = Business.objects.create(
            name='کسب‌وکار دیگر', template_key='retail',
        )
        foreign = ProductCategory.objects.create(
            business=other_shop, name='دستهٔ بیگانه',
        )
        response = self.client.post(
            '/api/products/',
            {'name': 'کالای مرزی', 'category': foreign.id},
            format='json', **self.headers,
        )
        self.assertEqual(response.status_code, 400, response.content)
        response = self.create_category('زیر بیگانه', parent=foreign.id)
        self.assertEqual(response.status_code, 400, response.content)

    def test_categories_are_scoped_to_the_business(self):
        self.make_tree()
        other_shop = Business.objects.create(
            name='کسب‌وکار سوم', template_key='cafe',
        )
        listing = self.client.get(
            '/api/product-categories/',
            HTTP_X_BUSINESS_ID=str(other_shop.id),
        )
        self.assertEqual(listing.data, [])


class CategoryAccessTests(CategoryBase):
    def test_seller_cannot_create_categories_but_owner_can(self):
        seller = User.objects.create_user(username='cat-seller', password=PW)
        BusinessMembership.objects.create(
            user=seller, business=self.shop, role='seller',
        )
        client = APIClient()
        client.force_authenticate(seller)
        response = client.post(
            '/api/product-categories/', {'name': 'دستهٔ فروشنده'},
            format='json', **self.headers,
        )
        self.assertEqual(response.status_code, 403, response.content)
        response = self.create_category('دستهٔ مالک')
        self.assertEqual(response.status_code, 201, response.content)
