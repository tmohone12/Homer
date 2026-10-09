---
schema: homer.character-culture/1
id: mara
revision: 7
control:
  mode: npc
source:
  document: characters/mara.md
  anchor: mara
  revision: '7'
names:
- id: primary_name
  kind: primary
  text: Mara Reedbank
  visibility:
  - public
- id: private_alias
  kind: alias
  text: Reed
  visibility:
  - gm
  - character:mara
  - character:maer
---

# Mara Reedbank

Illustrative fiction only; not user campaign canon. All references are sample IDs.

## Background

Raised in ferry-guild households. She has never held a hereditary title.

## Appearance

```yaml
- id: eyebrow_scar
  status: known
  text: A pale scar crosses her left eyebrow.
  visibility:
  - public
```

## Current

```yaml
- id: location
  kind: location
  status: known
  ref: reed_quay
  as_of: arrival_12
  visibility:
  - public
- id: role
  kind: title_role
  status: known
  text: Ferry clerk
  visibility:
  - public
- id: condition
  kind: condition
  status: known
  text: Uninjured, short of sleep
  visibility:
  - public
- id: allegiance
  kind: allegiance
  status: known
  ref: quay_council
  visibility:
  - public
- id: emotion
  kind: emotion
  status: known
  text: Wary of the unfamiliar guest.
  as_of: arrival_12
  expires_after: quay_evening
  visibility:
  - gm
  - character:mara
```

## Goals

Recover the missing toll ledger before the audit.

## House

```yaml
birth:
  status: known
  ref: house_reedbank
current:
  status: known
  ref: house_morrow
sworn_allegiance:
  status: none
```

## Cultures

```yaml
- culture_ref: river_towns
  variant_ref: ferry_guild
  relation: upbringing
  familiarity: deep
  identification: mixed
  visibility:
  - public
```

## Culture Deviations

```yaml
- culture_ref: river_towns
  cue_ref: guest_water
  text: Follows the custom with strangers; deliberately skips it with an estranged
    sibling.
  visibility:
  - gm
  - character:mara
```
