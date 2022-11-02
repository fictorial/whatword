# WhatWord

https://whatword.wtf

- Be the first to guess a secret word
- Web-based word game
- Each player has 2 minutes to make up to 6 guesses
- Each letter is colored based on comparison to the same position in the secret word
  - green: exact match
  - yellow: guessed letter present but not in given position
  - light gray: guessed letter is not in the secret word

## Tech

Client:

- HTML5
- CSS
- "Vanilla" JavaScript
- EventSource

Server:

- Node.js; Express
- Server Sent Events (SSE)
- Digital Ocean App Platform

Database:

- None; signed HTTP-only cookie stores player ID and name

## License

UNLICENSED

