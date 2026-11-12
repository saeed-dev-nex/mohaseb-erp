# استقرار Production روی ویندوز

در حالت Production، محاسب پرو با **یک پردازه و یک پورت** اجرا می‌شود:
سرور ASGI به نام Daphne هم‌زمان رابط کاربری (بیلد فرانت‌اند)، API و
وب‌سوکت‌ها را سرویس می‌دهد؛ دیگر خبری از `runserver` و `vite preview`
(که ابزار توسعه‌اند) نیست.

## اجرا

```bat
run_production.bat
```

این اسکریپت به‌ترتیب:

1. آپدیت پروژه را بررسی می‌کند (همان `update_project.ps1`؛ با
   `MOHASEB_SKIP_UPDATE=1` رد می‌شود).
2. محیط پایتون و وابستگی‌ها را آماده و Migrationها را اعمال می‌کند.
3. اگر `DJANGO_SECRET_KEY` تنظیم نشده باشد، یک کلید تصادفی امن می‌سازد و
   در `backend\.secret_key` نگه می‌دارد تا با هر ری‌استارت، نشست‌های
   کاربران باطل نشود. **این فایل را مثل رمز نگه دارید** و در گیت نیست.
4. فرانت‌اند را فقط در صورت تغییر سورس، دوباره بیلد می‌کند.
5. سرور را روی پورت `MOHASEB_PORT` (پیش‌فرض 8000) بالا می‌آورد.

آدرس دسترسی کلاینت‌ها: `http://<IP-سرور>:8000`

برای توقف، پنجرهٔ `Mohaseb-Production` را ببندید.

## متغیرهای محیطی مهم

| متغیر | پیش‌فرض | توضیح |
|---|---|---|
| `MOHASEB_PORT` | `8000` | پورت سرور Production |
| `DJANGO_SECRET_KEY` | از `backend\.secret_key` | کلید امضای توکن‌ها؛ در Production الزامی است |
| `DJANGO_HTTPS` | `false` | فعال‌سازی کوکی‌های Secure، ریدایرکت HTTPS و HSTS — فقط وقتی برنامه واقعاً با HTTPS سرو می‌شود |
| `DJANGO_BEHIND_PROXY` | `false` | وقتی یک Reverse Proxy جلوی برنامه HTTPS را تمام می‌کند؛ اعتماد به `X-Forwarded-Proto/Host` |
| `DJANGO_SERVE_FRONTEND` | در Production روشن | سرویس‌دهی بیلد فرانت‌اند و فایل‌های مدیا توسط خود برنامه |
| `DJANGO_FRONTEND_DIST` | `frontend\dist` | مسیر بیلد فرانت‌اند |
| `DJANGO_DB_PATH` / `DJANGO_MEDIA_ROOT` | پیش‌فرض پروژه | جابه‌جایی فایل دیتابیس و پوشهٔ مدیا (مثلاً به درایو داده) |
| `DJANGO_TIME_ZONE` | `Asia/Tehran` | منطقهٔ زمانی گزارش‌ها، سررسیدها و بکاپ‌ها |
| `DJANGO_BACKUP_SCHEDULER_ENABLED` | `true` | فعال‌سازی بکاپ خودکار داخلی در پردازهٔ Daphne؛ برای زمان‌بندی بیرونی روی `false` بگذارید |

## HTTPS

روی شبکهٔ داخلیِ مطمئن، HTTP ساده کافی است و `DJANGO_HTTPS` باید خاموش
بماند (در غیر این صورت کوکی‌های Secure روی HTTP ارسال نمی‌شوند و ورود
ناممکن می‌شود). اگر برنامه از اینترنت یا شبکهٔ غیرمطمئن در دسترس است،
یک Reverse Proxy با گواهی TLS جلوی آن بگذارید و هر دو متغیر را روشن کنید:

```text
DJANGO_HTTPS=true
DJANGO_BEHIND_PROXY=true
```

نمونه با Caddy (گواهی خودکار):

```text
mohaseb.example.com {
    reverse_proxy 127.0.0.1:8000
}
```

## اجرای دائمی به‌صورت Windows Service (اختیاری)

با ابزار [NSSM](https://nssm.cc/download) می‌توان سرور را به‌صورت سرویسی
ثبت کرد که با بالا آمدن ویندوز خودکار اجرا شود و با خطا ری‌استارت شود:

```bat
nssm install MohasebPro "%CD%\backend\run_production_server.bat"
nssm set MohasebPro AppDirectory "%CD%"
nssm set MohasebPro Start SERVICE_AUTO_START
nssm start MohasebPro
```

نکته: در حالت سرویس، آپدیت خودکارِ هنگام اجرا انجام نمی‌شود؛ برای آپدیت،
سرویس را متوقف کنید، یک بار `run_network.bat` یا `run_production.bat` را
دستی اجرا کنید و سرویس را دوباره استارت بزنید.

## نکات

- پنل ادمین جنگو (`/admin/`) برای کار روزمره استفاده نمی‌شود؛ فایل‌های
  استاتیک آن در این حالت سرو نمی‌شوند.
- بکاپ‌گیری از داخل خود برنامه انجام می‌شود و مستقل از این تنظیمات است؛
  فایل `backend\.secret_key` جزو دیتابیس نیست، جداگانه از آن نگه‌داری کنید.
- برای چند شعبه یا کاربران هم‌زمان زیاد، مسیر ارتقا PostgreSQL و استقرار
  لینوکسی (Docker Compose آماده است) در نقشهٔ راه آمده است.
