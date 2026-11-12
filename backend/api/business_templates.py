"""Job templates (قالب‌های شغلی) — the per-trade profiles of a Business.

A template decides which modules a business uses, the words its UI
speaks, and the defaults later phases build on. Templates are product
definitions, so they live in code and are versioned with the app; a
Business stores only its template key plus an optional module
override.

Modules split in two: the ones the product already has (the
mohaseb-pro base) and the ERP roadmap modules. A template may declare
roadmap modules today so the data model, the API and the UI shell can
already see the shape of the business; each module itself lands in
its own phase (accounting → phase 1, inventory/sales/purchase →
phase 2, HR/payroll → phase 3, tax/assets → phase 4).
"""

# Modules the base product already provides.
BASE_MODULES = (
    'invoices', 'customers', 'services', 'expenses', 'cheques',
    'reports', 'chat', 'staff', 'settings', 'users', 'backup',
)

# ERP roadmap modules (declared by templates, built phase by phase).
ROADMAP_MODULES = (
    'accounting', 'inventory', 'sales', 'purchase', 'hr', 'payroll',
    'tax', 'assets',
)

ALL_MODULE_KEYS = BASE_MODULES + ROADMAP_MODULES

TEMPLATES = {
    'services_repair': {
        'title': 'خدمات و تعمیرات',
        'description': 'تعمیرگاه و خدمات فنی؛ ادامهٔ طبیعی محاسب‌پرو با فاکتور خدمات، خودرو و پورسانت تکنسین.',
        'modules': BASE_MODULES + ('accounting', 'inventory', 'tax'),
        'terminology': {
            'customer': 'مشتری',
            'invoice': 'فاکتور خدمات',
            'item': 'خدمت و قطعه',
        },
    },
    'retail': {
        'title': 'فروشگاه و خرده‌فروشی',
        'description': 'فروش کالامحور با انبار، قیمت فروش و فاکتور سریع فروشگاهی.',
        'modules': (
            'invoices', 'customers', 'services', 'expenses', 'cheques',
            'reports', 'settings', 'users', 'backup',
            'accounting', 'inventory', 'sales', 'purchase', 'payroll', 'tax',
        ),
        'terminology': {
            'customer': 'مشتری',
            'invoice': 'فاکتور فروش',
            'item': 'کالا',
        },
    },
    'trade': {
        'title': 'بازرگانی و پخش',
        'description': 'خرید و فروش عمده، پخش و ویزیتوری با اعتبار مشتری و پورسانت فروش.',
        'modules': BASE_MODULES + (
            'accounting', 'inventory', 'sales', 'purchase', 'payroll', 'tax', 'assets',
        ),
        'terminology': {
            'customer': 'مشتری / عامل فروش',
            'invoice': 'فاکتور فروش',
            'item': 'کالا',
        },
    },
    'manufacturing': {
        'title': 'تولیدی و صنعتی',
        'description': 'تولید با انبار مواد و محصول، بهای تمام‌شده و دارایی و استهلاک.',
        'modules': BASE_MODULES + ROADMAP_MODULES,
        'terminology': {
            'customer': 'مشتری',
            'invoice': 'فاکتور فروش',
            'item': 'کالا / محصول',
        },
    },
    'restaurant': {
        'title': 'رستوران و کافه',
        'description': 'فروش روزانه، انبار مواد اولیه و تسویهٔ صندوق.',
        'modules': (
            'invoices', 'customers', 'services', 'expenses', 'cheques',
            'reports', 'settings', 'users', 'backup',
            'accounting', 'inventory', 'sales', 'payroll', 'tax',
        ),
        'terminology': {
            'customer': 'مشتری',
            'invoice': 'صورتحساب',
            'item': 'قلم منو / کالا',
        },
    },
    'general': {
        'title': 'خدمات عمومی',
        'description': 'پروفایل سادهٔ خدماتی برای کسب‌وکارهایی که قالب اختصاصی ندارند.',
        'modules': BASE_MODULES + ('accounting', 'tax'),
        'terminology': {
            'customer': 'مشتری',
            'invoice': 'فاکتور',
            'item': 'خدمت',
        },
    },
}

TEMPLATE_CHOICES = [(key, spec['title']) for key, spec in TEMPLATES.items()]

DEFAULT_TEMPLATE_KEY = 'services_repair'


def get_template(key):
    """Template spec for *key*, falling back to the default template."""
    return TEMPLATES.get(key) or TEMPLATES[DEFAULT_TEMPLATE_KEY]


def template_modules(key):
    return list(get_template(key)['modules'])


def templates_payload():
    """Serializable registry for the API (templates endpoint)."""
    return [
        {
            'key': key,
            'title': spec['title'],
            'description': spec['description'],
            'modules': list(spec['modules']),
            'terminology': spec['terminology'],
        }
        for key, spec in TEMPLATES.items()
    ]
