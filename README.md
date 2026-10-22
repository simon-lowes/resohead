# resohead.com

A self-hosted static copy of resohead.com, taken from WordPress.com on 22 Oct 2026. The live pages (home and 404) match the original pixel for pixel at desktop and mobile widths. It needs no WordPress and no database: a dependency-free Node server (`site/server.mjs`) serves the files and handles the contact form.

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

Spam protection: the Akismet honeypot field, plus a limit of 5 posts per IP per 10 minutes.

## Deploy (Dokploy)

- Application, build type **Dockerfile**, container port **3000**.
- Volume: mount persistent storage at `/data`.
- Env (optional, for email): `RESEND_API_KEY`, `CONTACT_TO=resohead74@gmail.com`, `CONTACT_FROM=Resohead <website@yourdomain>`.
- Health check: `GET /healthz`.

## Large files

GitHub rejects files over 100 MB, so files over 45 MB are committed in parts (`*.part-aa`, `-ab`, ...) and the Dockerfile joins them during the build. Re-run `tools/split-large.sh` after a re-snapshot.

## Re-snapshot (while the WordPress.com site still exists)

```sh
cd tools && ln -s "$(npm root -g)/playwright" node_modules/playwright  # once
node record.mjs https://resohead.com/ > /dev/null   # optional: re-record lazy-loaded requests to requests.txt
cd .. && python3 -I tools/snapshot.py tools/requests.txt && tools/split-large.sh
node tools/compare.mjs http://localhost:3000 .cache/compare   # pixel and request check against live
```

## Not cloned

- `/clients/` is a Jetpack CRM client login portal. It needs WordPress and its CRM data, which aren't in the WordPress export, so it now returns 404. Nothing on the site links to it.
- The search box on the 404 page has no search backend, so it lands on the home page.
