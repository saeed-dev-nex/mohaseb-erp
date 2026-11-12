from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction
import secrets


class Command(BaseCommand):
    help = "Create the default administrator only when no superuser exists."

    def handle(self, *args, **options):
        user_model = get_user_model()

        with transaction.atomic():
            if user_model.objects.filter(is_superuser=True).exists():
                self.stdout.write("A superuser already exists; no account was changed.")
                return

            user, created = user_model.objects.get_or_create(
                username="admin",
                defaults={"email": ""},
            )
            user.is_active = True
            user.is_staff = True
            user.is_superuser = True
            initial_password = secrets.token_urlsafe(18)
            user.set_password(initial_password)
            user.save()

        action = "created" if created else "promoted the existing 'admin' account"
        self.stdout.write(self.style.SUCCESS(
            f"No superuser was found. The default administrator was {action}."
        ))
        self.stdout.write("Username: admin")
        self.stdout.write(f"Initial password (save it now): {initial_password}")
