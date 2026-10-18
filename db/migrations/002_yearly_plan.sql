INSERT INTO plans (id, slug, name, price_brl, billing_interval, active)
SELECT
  '22222222-2222-4222-8222-222222222222',
  'basic_yearly',
  'Anual',
  59.90,
  'year',
  1
WHERE NOT EXISTS (SELECT 1 FROM plans WHERE slug = 'basic_yearly');
