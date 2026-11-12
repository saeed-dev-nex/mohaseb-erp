from django.core.management.base import BaseCommand
from api.models import VehicleType


INITIAL_VEHICLE_TYPES = [
    'پراید',
    'سمند',
    'پژو ۲۰۶',
    'پژو ۴۰۵',
    'پژو ۲۰۷',
    'رانا',
    'دنا',
    'دنا پلاس',
    'آریا',
    'تارا',
    'شاهین',
    'کوییک',
    'کوییک R',
    'کوییک S',
    'سوزوکی',
    'تیبا',
    'تیبا ۲',
    'ریو',
    'سراتو',
    'اپتیما',
    'توسان',
    'سورنتو',
    'اسپورتیج',
    'پاجرو',
    'سانتافه',
    'هایما',
    'MVM 110',
    'MVM 315',
    'برلیانس H320',
    'برلیانس H330',
    'جک S3',
    'جک S5',
    'لیفان 520',
    'لیفان 620',
    'فردا 511',
    'فردا آریزو ۵',
    'بسته‌بند سواری',
    'وانت پیکان',
    'وانت نیسان (زامیاد)',
    'وانت مزدا',
    'کامیونت',
    'میکروبوس',
    'موتورسیکلت هوندا',
    'موتورسیکلت ایران دوچرخ',
    'موتورسیکلت تی وی اس',
    'موتورسیکلت کبیر',
    'موتورسیکلت باجاج',
    'سه‌چرخه موتوری',
]


class Command(BaseCommand):
    help = 'Load initial vehicle types into the database'

    def handle(self, *args, **kwargs):
        created = 0
        for name in INITIAL_VEHICLE_TYPES:
            obj, is_new = VehicleType.objects.get_or_create(name=name)
            if is_new:
                created += 1
        self.stdout.write(
            self.style.SUCCESS(f'Done: {created} new types added (checked {len(INITIAL_VEHICLE_TYPES)})')
        )
