begin;

alter table app.practice_exercises
  drop constraint practice_exercises_comparison_mode_check,
  drop constraint practice_exercises_output_comparison_coherent;

alter table app.practice_exercises
  alter column comparison_mode set default 'auto',
  add constraint practice_exercises_comparison_mode_check
    check (comparison_mode in ('auto', 'exact', 'flexible')),
  add constraint practice_exercises_output_comparison_coherent
    check (
      (comparison_mode in ('auto', 'exact') and output_ignore_case = false and output_whitespace_mode = 'exact')
      or
      (comparison_mode = 'flexible' and (output_ignore_case = true or output_whitespace_mode <> 'exact'))
    );

commit;
