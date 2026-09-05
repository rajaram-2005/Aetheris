# Characters

Aetheris Characters is a persistent persona layer for one-to-one AI conversations. It is separate from the **agent hierarchy**: agents solve and route work, while characters provide a consistent voice and context for a conversation.

## Starter collection

The database is seeded on first use with 16 curated mythological characters:

| Collection / tradition | Characters |
|---|---|
| Hindu traditions | Shiva, Vishnu, Saraswati, Ganesha |
| Greek mythology | Athena, Apollo, Artemis, Hestia |
| Norse mythology | Odin, Thor, Freyja, Loki |
| Egyptian mythology | Isis (Aset), Ra, Thoth (Djehuty), Anubis (Anpu) |

The Hindu records describe a **living and internally diverse set of traditions**, not a single mythology canon. All collections include interpretation notes, conversation starters, distinct voice direction, and reminders to distinguish textual, regional, historical, and modern versions.

## Two conversation modes

- **Roleplay** is an immersive creative interpretation. The model can speak in first person, but cannot claim to literally be or channel a deity, offer supernatural certainty, issue divine commands, demand worship, or exploit fear and grief.
- **Guide** is educational. It favors third-person explanation, historical context, source families, competing versions, and explicit uncertainty. It must not fabricate scripture, verses, inscriptions, quotations, or scholarly consensus.

The current mode is visible above the conversation and can be changed at any time. Every request resolves the character and its prompt again from server-side storage; clients submit only `{id, mode}` and cannot inject a replacement character system prompt through this API.

## Custom characters

Characters → **Create character** opens the creator. A custom record includes:

- name, emoji avatar, collection/tradition and title;
- public-facing description and opening greeting;
- personality traits and conversation starters;
- detailed voice/background/boundary instructions;
- any source or interpretation note;
- roleplay, guide, or both modes.

Custom characters are private to the current anonymous browser identity or signed-in account. Owners can edit and delete them. Curated records are shared and immutable. Deleting a custom character keeps old local/cloud-synced transcripts, but the deleted persona can no longer generate new replies.

## Storage model

Records use the repository's single-instance `StorageProvider` convention:

- `data/characters.json` — built-in and custom character records;
- `data/character_meta.json` — seed schema version;
- custom records carry `ownerId`; built-ins carry `ownerId: null` and `builtIn: true`.

`data/` is intentionally Git-ignored and must live on a persistent volume in production. As with the rest of Aetheris's JSON store, run one application instance. Swapping the storage provider later does not change the character API.

## API

| Endpoint | Behavior |
|---|---|
| `GET /api/characters` | Curated characters plus the caller's private records; also returns available traditions. |
| `POST /api/characters` | Create a private character. |
| `GET /api/characters/:id` | Read a visible built-in or owned record. |
| `PATCH /api/characters/:id` | Edit an owned custom record. Built-ins cannot be changed. |
| `DELETE /api/characters/:id` | Delete an owned custom record. |
| `POST /api/chat` with `character: {id, mode}` | Chat using the server-resolved persona in `roleplay` or `guide` mode. |

Validation caps character text, list lengths, and modes in `src/lib/characters/index.ts`. Access checks are repeated for reads, edits, deletes, and chat resolution, so knowing another user's character id does not expose or activate it.
