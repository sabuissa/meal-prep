'use strict';

/* =========================================================
   Config
   ========================================================= */

const API_BASE = 'https://www.themealdb.com/api/json/v1/1';
const API = {
  cuisines: `${API_BASE}/list.php?a=list`,
  dishesByCuisine: (cuisine) => `${API_BASE}/filter.php?a=${encodeURIComponent(cuisine)}`,
  dishDetails: (id) => `${API_BASE}/lookup.php?i=${encodeURIComponent(id)}`,
};

// Soft, muted accent per cuisine. Anything not listed here falls back to
// ACCENT_FALLBACK so new/unknown cuisines from the API still render sanely.
const CUISINE_ACCENTS = {
  American: '#9AA5B1',
  British: '#A98CA0',
  Canadian: '#C08080',
  Chinese: '#C97B7B',
  Croatian: '#7FA79E',
  Dutch: '#D99B6C',
  Egyptian: '#C9B37E',
  French: '#8FA888',
  Greek: '#8CA9C4',
  Indian: '#D9A066',
  Irish: '#8FAE8B',
  Italian: '#D98E73',
  Jamaican: '#A3A86C',
  Japanese: '#7C8AA6',
  Kenyan: '#B98A6A',
  Malaysian: '#D1A85C',
  Mexican: '#C97B5E',
  Moroccan: '#CC8B65',
  Polish: '#C77F7F',
  Portuguese: '#D28C7D',
  Russian: '#8896B0',
  Spanish: '#D4B483',
  Thai: '#7FA8A0',
  Tunisian: '#C98868',
  Turkish: '#C98CA0',
  Vietnamese: '#9CB380',
  Unknown: '#A8A296',
};
const ACCENT_FALLBACK = '#A8A296';

// TheMealDB's area list (list.php?a=list) now lists ~195 world countries, but
// filter.php only has real recipes for this fixed set of classic areas —
// everything else returns null. Checking each cuisine's dish count via a live
// request (even bounded-concurrency) hammers the shared free-tier test key —
// observed to intermittently break subsequent requests, including the
// Add-to-plan/detail lookups — so cuisines without dishes are filtered out
// using this known-good allowlist instead of extra network calls.
const CUISINES_WITH_DISHES = new Set([
  'American', 'British', 'Canadian', 'Chinese', 'Croatian', 'Dutch', 'Egyptian',
  'French', 'Greek', 'Indian', 'Irish', 'Italian', 'Jamaican', 'Japanese',
  'Kenyan', 'Malaysian', 'Mexican', 'Moroccan', 'Polish', 'Portuguese',
  'Russian', 'Spanish', 'Thai', 'Tunisian', 'Turkish', 'Vietnamese',
]);

function getAccent(cuisine) {
  return CUISINE_ACCENTS[cuisine] || ACCENT_FALLBACK;
}

function mediumThumb(url) {
  return url ? `${url}/medium` : '';
}

/* =========================================================
   Persistence — saved days only (never the working plan or active day)
   ========================================================= */

const SAVED_DAYS_STORAGE_KEY = 'mealPlanner.savedDays';

function loadSavedDaysFromStorage() {
  try {
    const raw = localStorage.getItem(SAVED_DAYS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function persistSavedDays() {
  try {
    localStorage.setItem(SAVED_DAYS_STORAGE_KEY, JSON.stringify(state.savedDays));
  } catch (err) {
    // Storage can fail (quota exceeded, private browsing, disabled, ...) —
    // the app keeps working in memory even if persistence silently fails.
  }
}

/* =========================================================
   State
   ========================================================= */

const state = {
  cuisines: [],
  selectedCuisine: null,
  dishes: [],
  mealPlan: [], // each entry: { planId, idMeal, strMeal, strMealThumb, strArea, ingredients: [{ingredient, measure}] }
  // each entry: { id, name, dishes: [...] } — dishes is a deep copy of the
  // mealPlan entries at save time, structured the same way. Persisted to
  // localStorage on every change (see persistSavedDays) and reloaded on
  // init; the working plan and active day below are never persisted.
  savedDays: [],
  // id of the saved day currently loaded into "My Meal Plan", or null if the
  // working plan was built from scratch. Set only by loadDay(); determines
  // whether "Save to Day" overwrites that day in place or creates a new one.
  activeDayId: null,
};

let planIdCounter = 0;
let savedDayIdCounter = 0;

// cuisine -> dishes[], populated the first time a cuisine is selected so
// switching back to it later doesn't re-fetch the same data.
const dishesCache = new Map();

/* =========================================================
   DOM refs
   ========================================================= */

const els = {
  cuisineSelect: document.getElementById('cuisine-select'),
  dishesStatus: document.getElementById('dishes-status'),
  dishesGrid: document.getElementById('dishes-grid'),
  planStatus: document.getElementById('plan-status'),
  mealPlanList: document.getElementById('meal-plan-list'),
  saveDayBtn: document.getElementById('save-day-btn'),
  activeDayIndicator: document.getElementById('active-day-indicator'),
  savedDaysStatus: document.getElementById('saved-days-status'),
  savedDaysList: document.getElementById('saved-days-list'),
  shoppingStatus: document.getElementById('shopping-status'),
  shoppingList: document.getElementById('shopping-list'),
  modalOverlay: document.getElementById('meal-modal-overlay'),
  modalBody: document.getElementById('modal-body'),
  modalClose: document.getElementById('modal-close'),
  saveDayModalOverlay: document.getElementById('save-day-modal-overlay'),
  saveDayForm: document.getElementById('save-day-form'),
  saveDayInput: document.getElementById('save-day-input'),
  saveDayModalClose: document.getElementById('save-day-modal-close'),
  saveDayCancelBtn: document.getElementById('save-day-cancel-btn'),
  dayViewModalOverlay: document.getElementById('day-view-modal-overlay'),
  dayViewModalBody: document.getElementById('day-view-modal-body'),
  dayViewModalClose: document.getElementById('day-view-modal-close'),
};

/* =========================================================
   Status helpers
   ========================================================= */

function showLoading(el, message) {
  el.className = 'status-area loading';
  el.innerHTML = `<span class="spinner" aria-hidden="true"></span><span>${message}</span>`;
}

function showError(el, message) {
  el.className = 'status-area error';
  el.textContent = message;
}

function showEmpty(el, message) {
  el.className = 'status-area empty';
  el.textContent = message;
}

function clearStatus(el) {
  el.className = 'status-area';
  el.innerHTML = '';
}

/* =========================================================
   API calls
   ========================================================= */

async function fetchCuisines() {
  const res = await fetch(API.cuisines);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  const data = await res.json();
  return (data.meals || []).map((m) => m.strArea).filter(Boolean);
}

async function fetchDishesByCuisine(cuisine) {
  const res = await fetch(API.dishesByCuisine(cuisine));
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  const data = await res.json();
  return data.meals || [];
}

async function fetchDishDetails(idMeal) {
  const res = await fetch(API.dishDetails(idMeal));
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  const data = await res.json();
  const meal = (data.meals || [])[0];
  if (!meal) throw new Error('No details found for dish');
  return meal;
}

function extractIngredients(meal) {
  const ingredients = [];
  for (let i = 1; i <= 20; i++) {
    const ingredient = meal[`strIngredient${i}`];
    const measure = meal[`strMeasure${i}`];
    if (ingredient && ingredient.trim()) {
      ingredients.push({
        ingredient: ingredient.trim(),
        measure: measure && measure.trim() ? measure.trim() : '',
      });
    }
  }
  return ingredients;
}

/* =========================================================
   Rendering — cuisine selector
   ========================================================= */

function renderCuisineSelector() {
  state.cuisines.forEach((cuisine) => {
    const option = document.createElement('option');
    option.value = cuisine;
    option.textContent = cuisine;
    els.cuisineSelect.appendChild(option);
  });
  els.cuisineSelect.addEventListener('change', (e) => {
    if (e.target.value) {
      selectCuisine(e.target.value);
    } else {
      clearCuisineSelection();
    }
  });
}

// Resets the browse view when the user picks the blank placeholder option
// back out of the dropdown, instead of leaving the previous cuisine's
// dishes on screen.
function clearCuisineSelection() {
  state.selectedCuisine = null;
  state.dishes = [];
  updateSelectAccent();
  els.dishesGrid.innerHTML = '';
  showEmpty(els.dishesStatus, 'Select a cuisine to browse dishes.');
}

function updateSelectAccent() {
  els.cuisineSelect.style.setProperty('--accent-select', getAccent(state.selectedCuisine));
}

/* =========================================================
   Rendering — dish grid
   ========================================================= */

function renderDishes() {
  els.dishesGrid.innerHTML = '';
  state.dishes.forEach((dish) => {
    const card = document.createElement('div');
    card.className = 'dish-card';
    card.style.setProperty('--accent', getAccent(state.selectedCuisine));
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `View details for ${dish.strMeal}`);
    card.addEventListener('click', (e) => {
      if (e.target.closest('.add-btn')) return;
      showMealDetails(dish.idMeal);
    });
    card.addEventListener('keydown', (e) => {
      if (e.target.closest('.add-btn')) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        showMealDetails(dish.idMeal);
      }
    });

    const img = document.createElement('img');
    img.src = mediumThumb(dish.strMealThumb);
    img.alt = dish.strMeal;
    img.loading = 'lazy';

    const body = document.createElement('div');
    body.className = 'dish-card-body';

    const title = document.createElement('h3');
    title.textContent = dish.strMeal;

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'add-btn';
    addBtn.style.setProperty('--accent', getAccent(state.selectedCuisine));
    addBtn.textContent = 'Add to plan';
    addBtn.addEventListener('click', () => addDishToPlan(dish, addBtn));

    body.appendChild(title);
    body.appendChild(addBtn);
    card.appendChild(img);
    card.appendChild(body);
    els.dishesGrid.appendChild(card);
  });
}

/* =========================================================
   Rendering — meal plan
   ========================================================= */

function renderMealPlan() {
  els.mealPlanList.innerHTML = '';

  if (state.mealPlan.length === 0) {
    showEmpty(els.planStatus, 'Add dishes to start your meal plan');
    return;
  }
  clearStatus(els.planStatus);

  state.mealPlan.forEach((entry) => {
    const li = document.createElement('li');
    li.className = 'plan-item';
    li.style.setProperty('--accent', getAccent(entry.strArea));

    const header = document.createElement('div');
    header.className = 'plan-item-header';

    const img = document.createElement('img');
    img.src = mediumThumb(entry.strMealThumb);
    img.alt = entry.strMeal;
    img.loading = 'lazy';

    const title = document.createElement('h3');
    title.textContent = entry.strMeal;

    const tag = document.createElement('span');
    tag.className = 'cuisine-tag';
    tag.textContent = entry.strArea || '';

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = 'Remove';
    removeBtn.setAttribute('aria-label', `Remove ${entry.strMeal} from meal plan`);
    removeBtn.addEventListener('click', () => removeDishFromPlan(entry.planId));

    header.appendChild(img);
    header.appendChild(title);
    header.appendChild(tag);
    header.appendChild(removeBtn);

    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = `Ingredients (${entry.ingredients.length})`;

    const ul = document.createElement('ul');
    ul.className = 'ingredients';
    entry.ingredients.forEach((ing) => {
      const item = document.createElement('li');
      item.textContent = ing.measure ? `${ing.ingredient} — ${ing.measure}` : ing.ingredient;
      ul.appendChild(item);
    });

    details.appendChild(summary);
    details.appendChild(ul);

    li.appendChild(header);
    li.appendChild(details);
    els.mealPlanList.appendChild(li);
  });
}

/* =========================================================
   Rendering — saved days
   ========================================================= */

function renderSavedDays() {
  els.savedDaysList.innerHTML = '';

  if (state.savedDays.length === 0) {
    showEmpty(els.savedDaysStatus, 'No days saved yet.');
  } else {
    clearStatus(els.savedDaysStatus);

    state.savedDays.forEach((day) => {
      const li = document.createElement('li');
      li.className = 'saved-day-item' + (day.id === state.activeDayId ? ' active' : '');

      const name = document.createElement('span');
      name.className = 'saved-day-name';
      name.textContent = day.name;
      name.tabIndex = 0;
      name.setAttribute('role', 'button');
      name.setAttribute('aria-label', `View meals in ${day.name}`);
      name.addEventListener('click', () => showDayView(day.id));
      name.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          showDayView(day.id);
        }
      });

      const count = document.createElement('span');
      count.className = 'saved-day-count';
      count.textContent = `${day.dishes.length} meal${day.dishes.length === 1 ? '' : 's'}`;

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'edit-day-btn';
      editBtn.textContent = 'Edit';
      editBtn.setAttribute('aria-label', `Load ${day.name} into My Meal Plan`);
      editBtn.addEventListener('click', () => loadDay(day.id));

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'remove-btn';
      deleteBtn.textContent = 'Delete';
      deleteBtn.setAttribute('aria-label', `Delete ${day.name}`);
      deleteBtn.addEventListener('click', () => deleteSavedDay(day.id));

      li.append(name, count, editBtn, deleteBtn);
      els.savedDaysList.appendChild(li);
    });
  }

  updateActiveDayIndicator();
}

function updateActiveDayIndicator() {
  const activeDay = state.savedDays.find((day) => day.id === state.activeDayId);
  els.activeDayIndicator.textContent = activeDay
    ? `Editing "${activeDay.name}" — Save to Day will update it.`
    : '';
  els.saveDayBtn.textContent = activeDay ? `Save to ${activeDay.name}` : 'Save to Day';
}

/* =========================================================
   Rendering — shopping list
   ========================================================= */

// Aggregates ingredients across every dish currently in the plan (a dish
// added twice contributes its ingredients twice). Ingredients are grouped
// by name (lowercased + trimmed) so casing/whitespace differences merge
// into one line, but measures are only concatenated as text — never summed
// numerically. Reads directly from state.mealPlan, so a future custom-meal
// feature just needs to push entries with the same {ingredients} shape.
function buildShoppingList() {
  const grouped = new Map(); // lowercased/trimmed name -> { name, measures[] }

  state.mealPlan.forEach((entry) => {
    entry.ingredients.forEach((ing) => {
      const key = ing.ingredient.toLowerCase().trim();
      if (!grouped.has(key)) {
        grouped.set(key, { name: ing.ingredient.trim(), measures: [] });
      }
      if (ing.measure) {
        grouped.get(key).measures.push(ing.measure);
      }
    });
  });

  return Array.from(grouped.values());
}

// Only these weight/volume units are summed; a measure that isn't exactly
// {number}{unit} (counts, fractions, "Dash", cups, tbsp/tsp, ...) never
// parses, which is what forces the safe text-join fallback below.
const SUMMABLE_UNITS = /^(g|kg|ml|l)$/i;

function parseMeasure(measure) {
  const match = measure.trim().match(/^(\d+(?:\.\d+)?)\s*(g|kg|ml|l)$/i);
  if (!match) return null;
  return { amount: parseFloat(match[1]), unit: match[2].toLowerCase() };
}

// Sums measures only when every one of them parses to the same recognized
// unit; otherwise (mixed units, or anything unparseable) falls back to
// joining the raw measure text with "+", unchanged from before.
function formatMeasures(measures) {
  const parsed = measures.map(parseMeasure);
  const canSum = parsed.every((p) => p !== null && SUMMABLE_UNITS.test(p.unit) && p.unit === parsed[0].unit);

  if (canSum) {
    const total = parsed.reduce((sum, p) => sum + p.amount, 0);
    const rounded = Math.round(total * 1000) / 1000;
    return `${rounded}${parsed[0].unit}`;
  }

  return measures.join(' + ');
}

function renderShoppingList() {
  els.shoppingList.innerHTML = '';

  if (state.mealPlan.length === 0) {
    showEmpty(els.shoppingStatus, 'Add dishes to build your shopping list');
    return;
  }
  clearStatus(els.shoppingStatus);

  buildShoppingList().forEach((item) => {
    const li = document.createElement('li');
    li.textContent = item.measures.length > 0 ? `${item.name} — ${formatMeasures(item.measures)}` : item.name;
    els.shoppingList.appendChild(li);
  });
}

/* =========================================================
   Meal detail modal
   ========================================================= */

function openModal() {
  els.modalOverlay.classList.remove('hidden');
  document.body.classList.add('modal-open');
}

function closeModal() {
  els.modalOverlay.classList.add('hidden');
  document.body.classList.remove('modal-open');
  els.modalBody.innerHTML = '';
}

function renderMealDetails(meal) {
  els.modalBody.className = 'modal-body';
  els.modalBody.innerHTML = '';

  const img = document.createElement('img');
  img.className = 'modal-thumb';
  img.src = mediumThumb(meal.strMealThumb);
  img.alt = meal.strMeal;

  const title = document.createElement('h3');
  title.id = 'modal-meal-title';
  title.textContent = meal.strMeal;

  const meta = document.createElement('p');
  meta.className = 'modal-meta';
  meta.textContent = [meal.strCategory, meal.strArea].filter(Boolean).join(' · ');

  const ingredientsHeading = document.createElement('h4');
  ingredientsHeading.textContent = 'Ingredients';

  const ingredientsList = document.createElement('ul');
  ingredientsList.className = 'ingredients';
  extractIngredients(meal).forEach((ing) => {
    const li = document.createElement('li');
    li.textContent = ing.measure ? `${ing.ingredient} — ${ing.measure}` : ing.ingredient;
    ingredientsList.appendChild(li);
  });

  const instructionsHeading = document.createElement('h4');
  instructionsHeading.textContent = 'Instructions';

  const instructions = document.createElement('p');
  instructions.className = 'modal-instructions';
  instructions.textContent = meal.strInstructions || '';

  els.modalBody.append(img, title, meta, ingredientsHeading, ingredientsList, instructionsHeading, instructions);
}

async function showMealDetails(idMeal) {
  openModal();
  showLoading(els.modalBody, 'Loading recipe…');

  try {
    const meal = await fetchDishDetails(idMeal);
    renderMealDetails(meal);
  } catch (err) {
    showError(els.modalBody, "Couldn't load recipe details right now — please try again.");
  }
}

els.modalClose.addEventListener('click', closeModal);
els.modalOverlay.addEventListener('click', (e) => {
  if (e.target === els.modalOverlay) closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!els.modalOverlay.classList.contains('hidden')) closeModal();
  if (!els.saveDayModalOverlay.classList.contains('hidden')) closeSaveDayModal();
  if (!els.dayViewModalOverlay.classList.contains('hidden')) closeDayViewModal();
});

/* =========================================================
   Saved-day view modal (read-only)
   ========================================================= */

function openDayViewModal() {
  els.dayViewModalOverlay.classList.remove('hidden');
  document.body.classList.add('modal-open');
}

function closeDayViewModal() {
  els.dayViewModalOverlay.classList.add('hidden');
  document.body.classList.remove('modal-open');
  els.dayViewModalBody.innerHTML = '';
}

// Renders a saved day's meals (name, cuisine, collapsible ingredients) from
// data already in state — purely read-only, no fetch and no mutation of
// state.mealPlan or state.activeDayId.
function renderDayView(day) {
  els.dayViewModalBody.className = 'modal-body';
  els.dayViewModalBody.innerHTML = '';

  const title = document.createElement('h3');
  title.id = 'day-view-modal-title';
  title.textContent = day.name;

  const meta = document.createElement('p');
  meta.className = 'modal-meta';
  meta.textContent = `${day.dishes.length} meal${day.dishes.length === 1 ? '' : 's'}`;

  els.dayViewModalBody.append(title, meta);

  if (day.dishes.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'modal-instructions';
    empty.textContent = 'This day has no meals saved.';
    els.dayViewModalBody.appendChild(empty);
    return;
  }

  const list = document.createElement('ul');
  list.className = 'meal-plan-list';

  day.dishes.forEach((entry) => {
    const li = document.createElement('li');
    li.className = 'plan-item';
    li.style.setProperty('--accent', getAccent(entry.strArea));

    const header = document.createElement('div');
    header.className = 'plan-item-header';

    const img = document.createElement('img');
    img.src = mediumThumb(entry.strMealThumb);
    img.alt = entry.strMeal;
    img.loading = 'lazy';

    const name = document.createElement('h3');
    name.textContent = entry.strMeal;

    const tag = document.createElement('span');
    tag.className = 'cuisine-tag';
    tag.textContent = entry.strArea || '';

    header.append(img, name, tag);

    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = `Ingredients (${entry.ingredients.length})`;

    const ingredientsList = document.createElement('ul');
    ingredientsList.className = 'ingredients';
    entry.ingredients.forEach((ing) => {
      const item = document.createElement('li');
      item.textContent = ing.measure ? `${ing.ingredient} — ${ing.measure}` : ing.ingredient;
      ingredientsList.appendChild(item);
    });

    details.append(summary, ingredientsList);
    li.append(header, details);
    list.appendChild(li);
  });

  els.dayViewModalBody.appendChild(list);
}

function showDayView(dayId) {
  const day = state.savedDays.find((d) => d.id === dayId);
  if (!day) return;
  openDayViewModal();
  renderDayView(day);
}

els.dayViewModalClose.addEventListener('click', closeDayViewModal);
els.dayViewModalOverlay.addEventListener('click', (e) => {
  if (e.target === els.dayViewModalOverlay) closeDayViewModal();
});

/* =========================================================
   Actions
   ========================================================= */

function updatePlanViews() {
  renderMealPlan();
  renderShoppingList();
}

function removeDishFromPlan(planId) {
  state.mealPlan = state.mealPlan.filter((entry) => entry.planId !== planId);
  updatePlanViews();
}

function openSaveDayModal() {
  els.saveDayInput.value = '';
  els.saveDayModalOverlay.classList.remove('hidden');
  document.body.classList.add('modal-open');
  els.saveDayInput.focus();
}

function closeSaveDayModal() {
  els.saveDayModalOverlay.classList.add('hidden');
  document.body.classList.remove('modal-open');
}

// Deep-copies a list of plan entries (dish + its ingredients array) so the
// copy can never be mutated by later edits to whatever it was copied from.
// Used both when snapshotting the working plan into a saved day and when
// loading a saved day back into the working plan.
function cloneDishes(entries) {
  return entries.map((entry) => ({
    ...entry,
    ingredients: entry.ingredients.map((ing) => ({ ...ing })),
  }));
}

// Snapshots the current working plan under a user-given name, creating a
// brand-new saved day. Only reached when there's no active day — see
// handleSaveDayClick. Leaves activeDayId untouched (already null here) so a
// later edit-from-scratch continues to prompt for a name rather than
// silently updating this day.
function saveToDay(name) {
  const trimmedName = name.trim();
  if (!trimmedName) return;

  state.savedDays.push({
    id: ++savedDayIdCounter,
    name: trimmedName,
    dishes: cloneDishes(state.mealPlan),
  });
  persistSavedDays();
  renderSavedDays();
}

// Overwrites an already-active day's dishes with the current working plan
// (same name, no prompt) and refreshes its meal count in the list. Clears
// activeDayId afterwards — once a save completes, the next "Save to Day"
// should only update a day again if the user explicitly re-loads one.
function updateActiveDay(day) {
  day.dishes = cloneDishes(state.mealPlan);
  state.activeDayId = null;
  persistSavedDays();
  renderSavedDays();
}

function handleSaveDayClick() {
  const activeDay = state.savedDays.find((day) => day.id === state.activeDayId);
  if (activeDay) {
    updateActiveDay(activeDay);
  } else {
    openSaveDayModal();
  }
}

// Loads a saved day's dishes into "My Meal Plan" for editing and marks it
// as the active day. Warns before clobbering a non-empty working plan.
function loadDay(dayId) {
  const day = state.savedDays.find((d) => d.id === dayId);
  if (!day) return;

  if (state.mealPlan.length > 0) {
    const confirmed = confirm('This will replace your current meal plan. Continue?');
    if (!confirmed) return;
  }

  state.mealPlan = cloneDishes(day.dishes);
  state.activeDayId = day.id;
  updatePlanViews();
  renderSavedDays();
}

function deleteSavedDay(dayId) {
  state.savedDays = state.savedDays.filter((day) => day.id !== dayId);
  if (state.activeDayId === dayId) {
    state.activeDayId = null;
  }
  persistSavedDays();
  renderSavedDays();
}

els.saveDayBtn.addEventListener('click', handleSaveDayClick);
els.saveDayModalClose.addEventListener('click', closeSaveDayModal);
els.saveDayCancelBtn.addEventListener('click', closeSaveDayModal);
els.saveDayModalOverlay.addEventListener('click', (e) => {
  if (e.target === els.saveDayModalOverlay) closeSaveDayModal();
});
els.saveDayForm.addEventListener('submit', (e) => {
  e.preventDefault();
  saveToDay(els.saveDayInput.value);
  closeSaveDayModal();
});

async function selectCuisine(cuisine) {
  state.selectedCuisine = cuisine;
  updateSelectAccent();

  els.dishesGrid.innerHTML = '';

  const cached = dishesCache.get(cuisine);
  if (cached) {
    state.dishes = cached;
    clearStatus(els.dishesStatus);
    renderDishes();
    return;
  }

  showLoading(els.dishesStatus, 'Loading recipes…');

  try {
    const dishes = await fetchDishesByCuisine(cuisine);
    dishesCache.set(cuisine, dishes);
    state.dishes = dishes;

    if (dishes.length === 0) {
      showEmpty(els.dishesStatus, 'No dishes found for this cuisine.');
      return;
    }

    clearStatus(els.dishesStatus);
    renderDishes();
  } catch (err) {
    state.dishes = [];
    showError(els.dishesStatus, "Couldn't load recipes right now — please try again.");
  }
}

async function addDishToPlan(dish, buttonEl) {
  buttonEl.disabled = true;
  buttonEl.textContent = 'Adding…';

  try {
    const details = await fetchDishDetails(dish.idMeal);
    const entry = {
      planId: ++planIdCounter,
      idMeal: details.idMeal,
      strMeal: details.strMeal,
      strMealThumb: details.strMealThumb,
      strArea: details.strArea,
      ingredients: extractIngredients(details),
    };
    state.mealPlan.push(entry);
    updatePlanViews();
  } catch (err) {
    showError(els.planStatus, "Couldn't load recipes right now — please try again.");
  } finally {
    buttonEl.disabled = false;
    buttonEl.textContent = 'Add to plan';
  }
}

/* =========================================================
   Init
   ========================================================= */

async function init() {
  updatePlanViews(); // shows the empty-plan and empty-shopping-list states immediately

  // Only saved days persist across reloads — the working plan and active-day
  // state always start fresh.
  state.savedDays = loadSavedDaysFromStorage();
  savedDayIdCounter = state.savedDays.reduce((max, day) => Math.max(max, day.id), 0);
  renderSavedDays();

  showLoading(els.dishesStatus, 'Loading cuisines…');

  try {
    const allCuisines = await fetchCuisines();
    const cuisines = allCuisines.filter((cuisine) => CUISINES_WITH_DISHES.has(cuisine));
    state.cuisines = cuisines;
    renderCuisineSelector();

    if (cuisines.length > 0) {
      showEmpty(els.dishesStatus, 'Select a cuisine to browse dishes.');
    } else {
      showEmpty(els.dishesStatus, 'No cuisines available.');
    }
  } catch (err) {
    showError(els.dishesStatus, "Couldn't load recipes right now — please try again.");
  }
}

init();
