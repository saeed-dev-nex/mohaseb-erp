# تست‌های سرتاسری (Playwright E2E)

سه جریان پولیِ حیاتی را روی یک استک کامل ولی دورریختنی اجرا می‌کند:
صدور فاکتور سریع و محاسبهٔ مبلغ نهایی، «صدور مشابه»، و چاپ تک‌صفحه‌ای A5.

## اجرا

```bash
# پیش‌نیاز: وابستگی‌های backend روی پایتون فعال نصب باشند
pip install -r ../backend/requirements.txt

npm install
npx playwright install chromium   # فقط بار اول
npm run test:e2e
```

`npm run test:e2e` اول فرانت را build می‌کند، بعد Playwright یک دیتابیس
SQLite موقت در `e2e/.tmp` می‌سازد، migrate و seed می‌کند
(`e2e/seed.py` — کاربر آزمایشی `e2e` با گذرواژهٔ `e2e-password`، فقط
برای همین دیتابیس دورریختنی)، بک‌اند را روی پورت 8931 بالا می‌آورد و
تست‌ها را اجرا می‌کند. هیچ دادهٔ واقعی لمس نمی‌شود.

## افزودن به CI

در صورت تمایل، این step را در جاب frontend فایل `.github/workflows/ci.yml`
بعد از Build اضافه کنید:

```yaml
- name: E2E tests
  working-directory: frontend
  run: |
    pip install -r ../backend/requirements.txt
    npx playwright install --with-deps chromium
    npm run test:e2e
```
