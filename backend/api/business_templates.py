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
    'cafe': {
        'title': 'کافی‌شاپ',
        'description': 'منوی نوشیدنی و خوراکی سبک، میز و سفارش بیرون‌بر.',
        'modules': (
            'invoices', 'customers', 'services', 'expenses', 'cheques',
            'reports', 'settings', 'users', 'backup',
            'accounting', 'inventory', 'sales', 'payroll', 'tax',
        ),
        'terminology': {
            'customer': 'مشتری',
            'invoice': 'صورتحساب',
            'item': 'قلم منو',
        },
        'invoice_profile': {
            'vehicle': False,
            'extras': [
                {'key': 'table_no', 'label': 'شماره میز', 'type': 'text'},
                {'key': 'order_type', 'label': 'نوع سفارش', 'type': 'select',
                 'options': ['سالن', 'بیرون‌بر']},
            ],
        },
        'catalog': _catalog(
            'اسپرسو', 'لاته', 'کاپوچینو', 'آمریکانو',
            'کیک روز', 'کروسان', 'آبمیوه طبیعی',
        ),
    },
    'beauty_salon': {
        'title': 'آرایشگاه و سالن زیبایی',
        'description': 'خدمات آرایشی با پورسانت آرایشگر و نوبت‌های روزانه.',
        'modules': BASE_MODULES + ('accounting', 'payroll', 'tax'),
        'terminology': {
            'customer': 'مشتری',
            'invoice': 'فاکتور خدمات',
            'item': 'خدمت',
        },
        'invoice_profile': {
            'vehicle': False,
            'extras': [
                {'key': 'stylist', 'label': 'آرایشگر', 'type': 'text'},
            ],
        },
        'catalog': _catalog(
            'کوتاهی مو', 'رنگ و مش', 'براشینگ', 'مانیکور',
            'پدیکور', 'اصلاح صورت', 'میکاپ',
        ),
    },
    'clinic': {
        'title': 'کلینیک و مطب',
        'description': 'ویزیت و خدمات درمانی سبک؛ فاکتور با نام پزشک و نوع خدمت.',
        'modules': BASE_MODULES + ('accounting', 'payroll', 'tax'),
        'terminology': {
            'customer': 'مراجعه‌کننده',
            'invoice': 'صورتحساب',
            'item': 'خدمت',
        },
        'invoice_profile': {
            'vehicle': False,
            'extras': [
                {'key': 'doctor', 'label': 'پزشک / درمانگر', 'type': 'text'},
                {'key': 'visit_type', 'label': 'نوع مراجعه', 'type': 'select',
                 'options': ['ویزیت', 'پیگیری', 'خدمات']},
            ],
        },
        'catalog': _catalog(
            'ویزیت عمومی', 'ویزیت تخصصی', 'تزریقات', 'پانسمان',
            'نوار قلب', 'سونوگرافی', 'فیزیوتراپی (جلسه)',
        ),
    },
    'carwash': {
        'title': 'کارواش',
        'description': 'شست‌وشوی خودرو با پلاک و نوع شست‌وشو روی فاکتور.',
        'modules': BASE_MODULES + ('accounting', 'tax'),
        'terminology': {
            'customer': 'مشتری',
            'invoice': 'فاکتور خدمات',
            'item': 'خدمت',
        },
        'invoice_profile': {
            'vehicle': True,
            'extras': [
                {'key': 'wash_type', 'label': 'نوع شست‌وشو', 'type': 'select',
                 'options': ['معمولی', 'ویژه (واکس)', 'نانو', 'صفرشویی']},
            ],
        },
        'catalog': _catalog(
            'شست‌وشوی بدنه', 'شست‌وشوی کامل', 'واکس و پولیش',
            'صفرشویی داخل', 'شست‌وشوی موتور', 'نانو سرامیک',
        ),
    },
    'education': {
        'title': 'آموزشگاه و آموزش',
        'description': 'شهریهٔ دوره و کلاس؛ فاکتور با نام دوره و ترم.',
        'modules': BASE_MODULES + ('accounting', 'payroll', 'tax'),
        'terminology': {
            'customer': 'هنرجو / دانش‌پذیر',
            'invoice': 'فاکتور شهریه',
            'item': 'دوره',
        },
        'invoice_profile': {
            'vehicle': False,
            'extras': [
                {'key': 'course', 'label': 'نام دوره', 'type': 'text'},
                {'key': 'term', 'label': 'ترم', 'type': 'text'},
            ],
        },
        'catalog': _catalog(
            'دوره زبان انگلیسی', 'دوره کامپیوتر', 'کلاس تقویتی ریاضی',
            'دوره موسیقی', 'دوره نقاشی', 'مشاوره تحصیلی',
        ),
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

# Catalog profile per trade — what the business's «کالاها و خدمات»
# catalog IS and which entry-form options it offers. ``kind='product'``
# trades stock physical goods: their catalog is the inventory Product
# list (code/barcode/unit/sale price, stock from purchases), and the
# starter catalog seeds Products. ``kind='service'`` trades sell
# services/menu items: the catalog is Service rows, and the entry form
# shows the commission block and the extra-service toggle only where
# the trade actually works that way (repair shops pay technician
# commission; salons pay operator commission; a restaurant menu item
# has neither). Kept as one mapping so a trade's catalog behaviour is
# reviewable at a glance.
CATALOG_PROFILES = {
    'services_repair': {'kind': 'service', 'commission': True, 'extra_service': True},
    'retail': {'kind': 'product', 'default_unit': 'عدد'},
    'restaurant': {'kind': 'service', 'commission': False, 'extra_service': False},
    'gas_station': {'kind': 'product', 'default_unit': 'لیتر'},
    'trade': {'kind': 'product', 'default_unit': 'عدد'},
    'manufacturing': {'kind': 'product', 'default_unit': 'عدد'},
    'cafe': {'kind': 'service', 'commission': False, 'extra_service': False},
    'beauty_salon': {'kind': 'service', 'commission': True, 'extra_service': False},
    'clinic': {'kind': 'service', 'commission': False, 'extra_service': False},
    'carwash': {'kind': 'service', 'commission': False, 'extra_service': False},
    'education': {'kind': 'service', 'commission': False, 'extra_service': False},
    'general': {'kind': 'service', 'commission': False, 'extra_service': False},
}

_DEFAULT_CATALOG_PROFILE = {'kind': 'service', 'commission': False, 'extra_service': False}


def template_catalog_profile(key):
    """Catalog profile for *key* (resolved like get_template)."""
    resolved = key if key in TEMPLATES else DEFAULT_TEMPLATE_KEY
    profile = CATALOG_PROFILES.get(resolved) or _DEFAULT_CATALOG_PROFILE
    return {
        'kind': profile.get('kind', 'service'),
        'commission': bool(profile.get('commission', False)),
        'extra_service': bool(profile.get('extra_service', False)),
        'default_unit': profile.get('default_unit') or 'عدد',
    }


def get_template(key):
    """Template spec for *key*, falling back to the default template."""
    return TEMPLATES.get(key) or TEMPLATES[DEFAULT_TEMPLATE_KEY]


def template_modules(key):
    return list(get_template(key)['modules'])


def template_invoice_profile(key):
    profile = dict(
        get_template(key).get('invoice_profile') or {'vehicle': False, 'extras': []}
    )
    # «کارت مشتری / کارت دفتر» is the government-counter (پیشخوان)
    # payment workflow: only trades whose operators pay on behalf of
    # customers see it on the invoice form.
    resolved = key if key in TEMPLATES else DEFAULT_TEMPLATE_KEY
    profile['payment_cards'] = resolved in ('services_repair', 'general')
    return profile


# ---------------------------------------------------------------------------
# Role presets per trade (بخش کاربران). A business's members hold one
# role; the role decides which modules of that business the member may
# use. The owner/manager roles see every module the business has;
# functional roles get the slice their job needs. Modules a role does
# not list are closed on the API as well as hidden in the UI — while
# server-side automation (an invoice posting its journal and stock
# movements) keeps working regardless of who issued the invoice.
# ---------------------------------------------------------------------------

_ALL = None  # sentinel: every module the business itself has

ROLE_PRESETS = {
    'product': [
        {'key': 'manager', 'label': 'مدیر', 'modules': _ALL},
        {'key': 'accountant', 'label': 'حسابدار', 'modules': [
            'invoices', 'customers', 'accounting', 'tax', 'reports',
            'cheques', 'expenses',
        ]},
        {'key': 'warehouse', 'label': 'انباردار', 'modules': [
            'inventory', 'services', 'customers',
        ]},
        {'key': 'seller', 'label': 'فروشنده', 'modules': [
            'invoices', 'customers', 'services', 'cheques',
        ]},
        {'key': 'viewer', 'label': 'مشاهده‌گر', 'modules': [
            'invoices', 'customers', 'reports',
        ]},
    ],
    'service': [
        {'key': 'manager', 'label': 'مدیر', 'modules': _ALL},
        {'key': 'accountant', 'label': 'حسابدار', 'modules': [
            'invoices', 'customers', 'accounting', 'tax', 'reports',
            'cheques', 'expenses',
        ]},
        {'key': 'operator', 'label': 'اپراتور', 'modules': [
            'invoices', 'customers', 'services', 'cheques',
        ]},
        {'key': 'viewer', 'label': 'مشاهده‌گر', 'modules': [
            'invoices', 'customers', 'reports',
        ]},
    ],
}


def template_role_presets(key):
    """Role presets for the trade of *key* (by its catalog kind)."""
    kind = template_catalog_profile(key)['kind']
    return ROLE_PRESETS.get(kind) or ROLE_PRESETS['service']


def role_modules(key, role):
    """Module list a *role* grants inside a business of template *key*.

    Returns None for full-access roles (owner/manager) and for unknown
    roles (legacy behaviour: no extra restriction).
    """
    if role in ('owner', 'manager'):
        return None
    for preset in template_role_presets(key):
        if preset['key'] == role:
            return preset['modules']
    return None


def template_income_basis(key):
    """What «درآمد» means for a trade: commission-based trades (دفاتر
    پیشخوان، تعمیرات، آرایشگاه) earn the commission; everyone else
    earns the sale itself."""
    return 'commission' if template_catalog_profile(key)['commission'] else 'sales'


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
            'invoice_profile': template_invoice_profile(key),
            'catalog_profile': template_catalog_profile(key),
            'role_presets': template_role_presets(key),
            'catalog': list(spec.get('catalog') or []),
        }
        for key, spec in TEMPLATES.items()
    ]
