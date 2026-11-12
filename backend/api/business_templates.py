"""Job templates (قالب‌های شغلی) — the per-trade profiles of a Business.

A template decides which modules a business uses, the words its UI
speaks, what its invoice looks like, and the starter catalog it
begins with. Templates are product definitions, so they live in code
and are versioned with the app; a Business stores only its template
key plus an optional module override.

The invoice profile is what makes trades differ in practice:
``vehicle`` toggles the vehicle block on the invoice form, and
``extras`` declares trade-specific fields (restaurant table number,
fuel liters/nozzle, …) that the form renders and stores in the
invoice's ``custom_fields`` JSON. ``catalog`` is the starter list of
services/items seeded into the business (idempotently, by title).

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


def _catalog(*titles):
    return [{'title': title, 'default_main_price': 0} for title in titles]


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
        'invoice_profile': {
            'vehicle': True,
            'extras': [],
        },
        'catalog': _catalog(
            'تعویض روغن موتور', 'تعمیر موتور', 'جلوبندی و تعلیق',
            'تعویض لنت ترمز', 'دیاگ و عیب‌یابی', 'شارژ گاز کولر',
        ),
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
        'invoice_profile': {
            'vehicle': False,
            'extras': [
                {'key': 'sales_channel', 'label': 'کانال فروش', 'type': 'select',
                 'options': ['حضوری', 'تلفنی', 'آنلاین']},
            ],
        },
        'catalog': _catalog(
            'کالای عمومی', 'نوشیدنی', 'خوراکی', 'شوینده و بهداشتی', 'سایر اقلام',
        ),
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
        'invoice_profile': {
            'vehicle': False,
            'extras': [
                {'key': 'table_no', 'label': 'شماره میز', 'type': 'text'},
                {'key': 'order_type', 'label': 'نوع سفارش', 'type': 'select',
                 'options': ['سالن', 'بیرون‌بر', 'پیک']},
            ],
        },
        'catalog': _catalog(
            'چلوکباب کوبیده', 'جوجه‌کباب', 'زرشک‌پلو با مرغ',
            'نوشابه', 'دوغ', 'سالاد فصل',
        ),
    },
    'gas_station': {
        'title': 'پمپ بنزین و جایگاه سوخت',
        'description': 'فروش فرآورده به لیتر، نازل و مخزن؛ فاکتور سوخت با مقدار و شمارهٔ نازل.',
        'modules': (
            'invoices', 'customers', 'services', 'expenses', 'cheques',
            'reports', 'staff', 'settings', 'users', 'backup',
            'accounting', 'inventory', 'tax',
        ),
        'terminology': {
            'customer': 'مشتری',
            'invoice': 'فاکتور فروش سوخت',
            'item': 'فرآورده',
        },
        'invoice_profile': {
            'vehicle': False,
            'extras': [
                {'key': 'liters', 'label': 'مقدار (لیتر)', 'type': 'number'},
                {'key': 'nozzle', 'label': 'شماره نازل', 'type': 'text'},
                {'key': 'plate', 'label': 'پلاک خودرو', 'type': 'text'},
            ],
        },
        'catalog': _catalog(
            'بنزین معمولی', 'بنزین سوپر', 'گازوئیل', 'گاز طبیعی (CNG)',
            'روغن موتور', 'سایر فرآورده‌ها و خدمات',
        ),
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
        'invoice_profile': {
            'vehicle': False,
            'extras': [
                {'key': 'visitor', 'label': 'ویزیتور', 'type': 'text'},
            ],
        },
        'catalog': _catalog('کالای عمومی', 'هزینه حمل و پخش'),
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
        'invoice_profile': {
            'vehicle': False,
            'extras': [],
        },
        'catalog': _catalog('محصول تولیدی', 'خدمات تولید'),
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
        'invoice_profile': {
            'vehicle': False,
            'extras': [],
        },
        'catalog': _catalog('خدمت عمومی'),
    },
}

TEMPLATE_CHOICES = [(key, spec['title']) for key, spec in TEMPLATES.items()]

DEFAULT_TEMPLATE_KEY = 'services_repair'


def get_template(key):
    """Template spec for *key*, falling back to the default template."""
    return TEMPLATES.get(key) or TEMPLATES[DEFAULT_TEMPLATE_KEY]


def template_modules(key):
    return list(get_template(key)['modules'])


def template_invoice_profile(key):
    return get_template(key).get('invoice_profile') or {'vehicle': False, 'extras': []}


def template_catalog(key):
    return list(get_template(key).get('catalog') or [])


def templates_payload():
    """Serializable registry for the API (templates endpoint)."""
    return [
        {
            'key': key,
            'title': spec['title'],
            'description': spec['description'],
            'modules': list(spec['modules']),
            'terminology': spec['terminology'],
            'invoice_profile': spec.get('invoice_profile') or {'vehicle': False, 'extras': []},
            'catalog': list(spec.get('catalog') or []),
        }
        for key, spec in TEMPLATES.items()
    ]
