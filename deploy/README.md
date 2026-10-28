# دليل نشر البوابة التعليمية

حزمة الإنتاج تجعل الواجهة هي الخدمة الوحيدة المرتبطة بالمضيف (`127.0.0.1:8080`). قاعدة البيانات وAPI وخدمة تنفيذ Python تعمل داخل شبكات Docker خاصة، ولا تملك خدمة API منفذ Docker. خدمة Runner وحدها تصل إلى Docker لإنشاء حاوية Python قصيرة العمر بلا شبكة وبحدود موارد.

## قبل النشر

1. جهّز خادم Linux محدثًا، Docker Engine وCompose، واسم نطاق يشير إليه.
2. انسخ `.env.production.example` إلى `.env.production` وولّد أسرارًا مستقلة بطول 32 محرفًا على الأقل.
3. شغّل `pnpm release:preflight -- deploy/.env.production` ثم `docker compose --env-file deploy/.env.production -f compose.production.yaml config --quiet`.
4. ثبّت Caddy على المضيف واستخدم `Caddyfile.example` لإنهاء TLS تلقائيًا. لا تفتح المنفذ 8080 للعامة.
5. اسحب صورة Python المثبتة، والأفضل تثبيت digest للصورة بعد اختباره.
6. قبل فتح التسجيل شغّل `pnpm test:runner-load` وعدّل `RUNNER_MAX_CONCURRENCY` تدريجيًا بعد قياس CPU والذاكرة، لا بالتخمين.

## التشغيل والترقية

```bash
docker pull python:3.12-alpine
docker compose --env-file deploy/.env.production -f compose.production.yaml build --pull
docker compose --env-file deploy/.env.production -f compose.production.yaml up -d
docker compose --env-file deploy/.env.production -f compose.production.yaml ps
sh deploy/scripts/healthcheck.sh https://portal.example.edu
```

خدمة `migrate` تسبق API وتتوقف بعد نجاح الترحيلات. جميع الخدمات لها healthchecks وإعادة تشغيل تلقائية وحدود لحجم السجلات.

## النسخ الاحتياطي والاستعادة

شغّل `sh deploy/scripts/backup.sh deploy/.env.production` يوميًا وانسخ الناتج إلى مخزن خارجي مشفّر. ثبّت وحدة systemd والمؤقت الموجودين في `deploy/systemd` بعد تعديل مسار المشروع والمستخدم. اختبر الاستعادة شهريًا:

```bash
sh deploy/scripts/restore-drill.sh deploy/.env.production backups/learning-portal-YYYYMMDDTHHMMSSZ.dump
```

اختبار الاستعادة يستخدم قاعدة مؤقتة باسم ثابت ويحذفها بعد التحقق، ولا يلمس قاعدة الإنتاج.

## ضوابط الإطلاق

- اسم نطاق حقيقي وHTTPS إلزامي، مع جدار ناري يسمح فقط بـ80/443 وSSH المقيد.
- اجعل دخول المدير عبر VPN أو قائمة سماح لعناوين الإدارة على مستوى الخادم، واحتفظ بحساب مدير واحد فعّال للنسخة التجريبية.
- لا تستخدم ملف أسرار مشتركًا في Git ولا في سجل أو لقطة شاشة.
- راقب `/ready` كل دقيقة، ونبّه عند ثلاث إخفاقات متتالية أو امتلاء القرص أو توقف أي حاوية.
- نفّذ نسخة احتياطية قبل كل ترقية، واحتفظ بالإصدار السابق للرجوع السريع.
- بعد النشر اختبر من هاتف ومتصفحي Chromium وFirefox: الدخول، التسجيل، موافقة الإدارة، ظهور المقرر، حل تدريب، مراجعة الأستاذ، وتغيير كلمة المرور.
