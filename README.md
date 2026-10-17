# ارتقِ كل يوم — Quest Edition V4

ارفع محتويات هذا المجلد (وليس المجلد نفسه) إلى جذر مستودع GitHub Pages.

## حفظ البيانات
يحافظ التطبيق على قاعدة بيانات V2 الأصلية في localStorage تحت المفتاح `my-day-ag-v2`، وإضافات V4 في `irtaqi-quest-v4-extras`. خذ نسخة احتياطية قبل التحديث. النسخة V4 تدعم استيراد V2/V3 وV4.

## المزامنة الاختيارية عبر Supabase
أنشئ مشروع Supabase ثم نفّذ هذا SQL في SQL Editor:

```sql
create table if not exists public.irtaqi_backups (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.irtaqi_backups enable row level security;
create policy "read own backup" on public.irtaqi_backups for select to authenticated using ((select auth.uid()) = user_id);
create policy "insert own backup" on public.irtaqi_backups for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "update own backup" on public.irtaqi_backups for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
```

فعّل Email OTP من إعدادات Supabase Auth، واضبط قالب البريد ليحتوي على `{{ .Token }}` لو عايز رمزًا بدل رابط. استخدم فقط **publishable/anon** key، لا تستخدم `service_role` أو مفتاحًا سريًا. أدخل Project URL والمفتاح والبريد من إعدادات التطبيق. المزامنة يدوية وتستبدل البيانات عند الاستعادة؛ لا يوجد دمج أو مزامنة تلقائية. Access token يبقى في ذاكرة الصفحة فقط حتى إعادة تحميلها.

## مواقيت الصلاة
تحتاج الإنترنت، وتستخدم واجهة AlAdhan حسب المدينة والدولة وطريقة الحساب. ليست ضمانًا للدقة المحلية؛ راجعها. التنبيهات تعمل عند فتح التطبيق فقط، لا يوجد Push خلفي.

## ملاحظات
المؤقت يعمل في التبويب المفتوح؛ لا يسجل جلسة عند إغلاق الصفحة. أيام الإنقاذ لا تمنح XP. نظام مراجعة الدروس مستقل عن XP حتى لا يتضاعف الرصيد بالخطأ.
