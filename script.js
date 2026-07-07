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

function getAccent(cuisine) {
  return CUISINE_ACCENTS[cuisine] || ACCENT_FALLBACK;
}

function mediumThumb(url) {
  return url ? `${url}/medium` : '';
}

/* =========================================================
   State
   ========================================================= */

const state = {
  cuisines: [],
  selectedCuisine: null,
  dishes: [],
  mealPlan: [], // each entry: { planId, idMeal, strMeal, strMealThumb, strArea, ingredients: [{ingredient, measure}] }
};

let planIdCounter = 0;

/* =========================================================
   DOM refs
   ========================================================= */

const els = {
  cuisineSelect: document.getElementById('cuisine-select'),
  dishesStatus: document.getElementById('dishes-status'),
  dishesGrid: document.getElementById('dishes-grid'),
  planStatus: document.getElementById('plan-status'),
  mealPlanList: document.getElementById('meal-plan-list'),
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
    if (e.target.value) selectCuisine(e.target.value);
  });
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

    header.appendChild(img);
    header.appendChild(title);
    header.appendChild(tag);

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
   Actions
   ========================================================= */

async function selectCuisine(cuisine) {
  state.selectedCuisine = cuisine;
  updateSelectAccent();

  els.dishesGrid.innerHTML = '';
  showLoading(els.dishesStatus, 'Loading recipes…');

  try {
    const dishes = await fetchDishesByCuisine(cuisine);
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
    renderMealPlan();
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
  renderMealPlan(); // shows the empty-plan state immediately
  showLoading(els.dishesStatus, 'Loading cuisines…');

  try {
    const cuisines = await fetchCuisines();
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
