-- ── Transcripts and notes on a recording ──────────────────────────────
-- Two things the call log cannot answer today.
--
-- A transcript, because the one question the metadata genuinely cannot
-- settle is whether an OUTBOUND call reached a person or the customer's
-- voicemail. Vonage marks both "Answered" — from the carrier's side the
-- far end did pick up — and there is no field that separates them. Only
-- the audio does. The column exists now so the audio has somewhere to
-- land when a transcription service is wired in; nothing writes it yet.
--
-- Notes, because a recording is listened to by more than one person and
-- what they conclude currently goes nowhere. A series, not a field: the
-- second listener disagreeing with the first is the useful part.

alter table calls
  add column if not exists recording_transcript text,
  add column if not exists transcript_status text,
  add column if not exists transcript_engine text,
  add column if not exists transcript_at timestamptz;

comment on column calls.recording_transcript is
  'Plain text of the recording. Null until a transcription service fills it.';
comment on column calls.transcript_status is
  'pending | done | failed | unsupported — so a failure is visible rather than looking like "not done yet".';

create index if not exists idx_calls_transcript_pending
  on calls (start_time)
  where recording_url is not null and recording_transcript is null;

-- Full-text search over what has been transcribed, so "asked about
-- cover-ups" is findable without reading nine thousand recordings.
create index if not exists idx_calls_transcript_fts
  on calls using gin (to_tsvector('simple', coalesce(recording_transcript, '')));

create table if not exists call_notes (
  id           bigserial primary key,
  call_id      bigint not null references calls(id) on delete cascade,
  -- Who wrote it. The name is kept alongside the id because staff leave
  -- and the note still has to say who made the call it describes.
  author_id    integer references staff(id) on delete set null,
  author_name  text not null,
  body         text not null,
  -- Seconds into the recording, when the note is about a moment in it.
  at_seconds   integer,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  edited       boolean not null default false
);

create index if not exists idx_call_notes_call on call_notes (call_id, created_at);

drop trigger if exists trg_call_notes_updated_at on call_notes;
create trigger trg_call_notes_updated_at
  before update on call_notes
  for each row execute function set_updated_at();
