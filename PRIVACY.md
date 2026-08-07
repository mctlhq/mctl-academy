# Privacy

mctl Academy is a free study tool. It collects the minimum needed to remember
your progress, and nothing else.

## What is stored

| Data | Why | Source |
|---|---|---|
| Your email address | Required by the account system (better-auth); this application itself never emails you or displays it | GitHub or Google OAuth |
| GitHub login (username), if you sign in with GitHub | Shown in the interface so you know who you are signed in as | GitHub OAuth |
| Your name and profile image, as provided by the sign-in provider | Shown in the interface | GitHub or Google OAuth |
| Your attempts and answers | Progress tracking, Review-mistakes, and the dashboard | Your use of the app |
| Question reports you file | So a reported question can be fixed | Your use of the app |

That is the complete list.

## What is not stored

- **No analytics, no tracking pixels, no third-party scripts.** There is no
  analytics provider at MVP.
- **No advertising identifiers**, and no data is sold or shared with anyone.
- **No password.** Authentication is GitHub or Google OAuth only; this
  application never sees or stores a credential.
- **OAuth access and refresh tokens are encrypted at rest** and are never used
  to call the GitHub or Google API again after sign-in completes.

## A note on email

Earlier versions of this document said no email address was collected. That
was true only while sign-in was hand-rolled and requested the minimal `read:user`
GitHub scope. The account system this application now runs on (better-auth)
requires an email address as part of its own data model regardless of
provider, and both GitHub and Google return one during sign-in. This
application does not send you email and does not display your address to
other users — it exists in the database as an account field, nothing more.

## Sessions

Sessions are held in a secure, `HttpOnly`, `SameSite` cookie. The cookie carries
a signed session identifier, not your data. Each sign-in creates a new session;
sessions expire automatically and are revoked immediately on sign-out or
account deletion.

## Deleting your account

Account deletion is available in the application and takes effect immediately.
It removes your user record, every attempt and answer, and any reports you
filed, by cascade. Nothing is retained in a shadow copy.

Deleting your account does not delete the published questions themselves — those
are project content, not personal data.

## Where the data lives

PostgreSQL on the mctl platform, hosted in Germany (Hetzner). Backups go to
Cloudflare R2.

## Public repository

The application's source code and its entire question bank are public in this
repository. Your attempts are not — those live only in the application database
and are visible only to you.

## Contact

Open an issue in this repository, or email the address in the repository's
`SECURITY.md` for anything you would rather not discuss in public.
