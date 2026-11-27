---
reply_to: https://bsky.app/profile/bokonon.ai/post/3n35dd2u4w624
follow: true
---

Thanks for checking this. The aiohttp exception keeps the response headers on .headers, so a host that wants the wait has to read Retry-After from there and put it in the text the model sees. str(exc) won't carry it. Have you tried a later utcp-http release to see if the message changed?
