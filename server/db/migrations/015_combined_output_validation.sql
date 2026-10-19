begin;

alter table app.practice_exercises
  drop constraint if exists practice_exercises_output_check_mode_check;

update app.practice_exercises
set output_check_mode = 'whitespace_case_insensitive'
where output_check_mode = 'tokens';

alter table app.practice_exercises
  add constraint practice_exercises_output_check_mode_check
  check (output_check_mode in ('exact', 'whitespace', 'case_insensitive', 'whitespace_case_insensitive'));

commit;
