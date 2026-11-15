-- Opslag voor tekeningen bij oefeningen (al toegepast op project trainingsbouwer).
-- Private bucket: alleen ingelogde trainers kunnen lezen; uploaden alleen in de eigen map (<user-id>/...).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tekeningen','tekeningen', false, 2097152, array['image/png','image/jpeg'])
on conflict (id) do nothing;

create policy "tekeningen_lezen" on storage.objects for select to authenticated
  using (bucket_id = 'tekeningen' and (select public.is_trainer()));

create policy "tekeningen_uploaden" on storage.objects for insert to authenticated
  with check (bucket_id = 'tekeningen' and (select public.is_trainer())
              and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "tekeningen_verwijderen" on storage.objects for delete to authenticated
  using (bucket_id = 'tekeningen' and ((select public.is_beheerder())
         or (storage.foldername(name))[1] = (select auth.uid())::text));

-- Tekeningen die in de repo zelf staan (map img/) krijgen het voorvoegsel "asset:".
update public.oefeningen set tekening_pad = 'asset:bidon.png' where titel = 'Bidon op de ovaal';
