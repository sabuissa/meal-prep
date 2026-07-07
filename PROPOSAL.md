# PROPOSAL

## What I'm building
A cuisine-based meal planner where users filter recipes by world cuisine, add dishes to a builder, and get a consolidated shopping list of all ingredients across their selected meals — with the ability to save favorites and add their own dishes.

## Which API I'm using
**TheMealDB** — https://www.themealdb.com/api.php
Free, no API key required, works directly from GitHub Pages.

## Why I chose this
It solves a real problem I actually have: deciding what to cook across a week and figuring out what to buy. No single recipe page aggregates ingredients across multiple dishes, so the shopping-list feature is genuinely useful rather than decorative. I wanted an app with a clear user job, not just a data browser.

## Core features
1. **Filter recipes by cuisine/area** (e.g. Italian, Japanese, Mexican).
2. **Meal builder** — add selected dishes to a running list.
3. **Consolidated shopping list** — deduplicated ingredients across all chosen dishes, with measures displayed as grouped text (e.g. "Flour — 200g + 1 cup").
4. **Save favorites** using localStorage so they persist between visits.
5. **Add your own custom dishes**, stored locally in the same data shape as API dishes so they flow through the builder identically.

## What I don't know yet
- TheMealDB's filter endpoint (`filter.php?a=`) returns only skinny records (id, name, thumbnail). Getting ingredients requires a **second** call (`lookup.php?i=`) per dish. I haven't written multi-call async orchestration before, so batching several detail fetches at once (`Promise.all`) is new to me.
- Measures are stored as **free-text strings** ("1 tbsp", "a handful", "200g"), so I can group ingredients but can't reliably **sum** quantities across dishes. I need to see how messy this gets in practice.
- How to keep custom (localStorage) dishes and API dishes in one consistent structure so the aggregation logic only has to be written once.

## Stated future extension (deliberately NOT in v1)
**Auto-calculated macros.** Scoped out of the first version on purpose: it would require a second, key-gated nutrition API plus fuzzy ingredient-name matching and free-text quantity parsing — high failure risk. May revisit later as manual-entry-only.
