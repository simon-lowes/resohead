# resohead.com

A self-hosted static copy of resohead.com, taken from WordPress.com on 21 Nov 2026. The live pages (home and 404) match the original pixel for pixel at desktop and mobile widths. It needs no WordPress and no database: a dependency-free Node server (`site/server.mjs`) serves the files and handles the contact form.

## What's in it

- `site/public/`: the pages and every asset they use, self-hosted: theme CSS and JS, Albert Sans fonts, images, PDFs, the multitrack download and the VideoPress video. Files keep their original `/wp-content/uploads/...` paths, so existing links still work. Files hosted elsewhere live under `/_ext/<host>/`.
- YouTube, Vimeo, SoundCloud, Bandcamp, PayPal and Fiverr stay as external embeds and links, as on the original site.
- WordPress.com tracking (stats, bilmur, the emoji script and bot protection) is removed.
- The VideoPress player is replaced by a native `<video>` of the same file, in the same box.
- `site/forms.json`: the contact form's fields, used by the server to label submissions.

## Contact form

The original Jetpack form script is unchanged. It posts to `/wp-admin/admin-ajax.php?action=grunion-contact-form` as it did before, and `server.mjs` answers in Jetpack's format, so validation and the "Thank you for your response. ✨" summary behave exactly as before. Every submission is:

1. appended to `$DATA_DIR/submissions.jsonl` (default `/data`; mount a volume there), and
2. emailed through Resend, if `RESEND_API_KEY`, `CONTACT_TO` and `CONTACT_FROM` are set. `CONTACT_FROM` must use a domain verified in Resend. Replies go to the sender's address.

Spam protection: the Akismet honeypot field, a limit of 5 posts per IP per 10 minutes, and, if `TYPESAFE_API_KEY` is set, a check by TypeSafe's Jev model (`site/spam.mjs`). Jev answers three yes/no questions (is it a sales pitch, is it about Resohead's music, is it meaningless) and code decides: a pitch that isn't about the music, or a meaningless message, is spam. Spam is saved to `submissions.jsonl` with `"spam": {...}` but not emailed; the sender sees the usual thank-you. Anything unsure, and any failed check, is emailed as normal. Each check sends the name, email and message to TypeSafe and costs a tiny fraction of a penny. Tests: `node --test site/spam.test.mjs`.

## Deploy (Dokploy)

- Application, build type **Dockerfile**, container port **3000**.
- Volume: mount persistent storage at `/data`.
- Env (optional, for email): `RESEND_API_KEY`, `CONTACT_TO=resohead74@gmail.com`, `CONTACT_FROM=Resohead <website@yourdomain>`.
- Env (optional, for the spam check): `TYPESAFE_API_KEY`, and `JEV_MODEL` (default `jev-latest`; pin a version once you're happy with it).
- Health check: `GET /healthz`.

## Large files

GitHub rejects files over 100 MB, so files over 45 MB are committed in parts (`*.part-aa`, `-ab`, ...) and the Dockerfile joins them during the build. Re-run `tools/split-large.sh` after a re-snapshot.

## Re-snapshot (while the WordPress.com site still exists)

Since Nov 2026 resohead.com redirects to the WordPress.com staging address, `resohead.wpcomstaging.com`, so pages are fetched from there. Set `SNAPSHOT_SOURCE` to use another address. The output still presents itself as `https://resohead.com`: canonical and `og:` URLs are absolute on that host, and nothing in it points to the staging host.

```sh
cd tools && ln -s "$(npm root -g)/playwright" node_modules/playwright  # once
node record.mjs https://resohead.wpcomstaging.com/ > /dev/null   # optional: re-record lazy-loaded requests to requests.txt
cd .. && python3 -I tools/snapshot.py tools/requests.txt && tools/split-large.sh
node tools/compare.mjs http://localhost:3000 .cache/compare   # pixel and request check against the live source (LIVE=... to override)
```

## Not cloned

- `/clients/` is a Jetpack CRM client login portal. It needs WordPress and its CRM data, which aren't in the WordPress export, so it now returns 404. Nothing on the site links to it.
- The search box on the 404 page has no search backend, so it lands on the home page.
