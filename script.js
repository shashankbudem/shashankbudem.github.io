const header = document.querySelector("[data-header]");
const nav = document.querySelector("[data-nav]");
const navToggle = document.querySelector("[data-nav-toggle]");
const year = document.querySelector("[data-year]");

if (year) {
  year.textContent = new Date().getFullYear();
}

// Working full time since June 2022; keep the years-of-experience figures current.
const EXPERIENCE_START = new Date(2022, 5, 1);
document.querySelectorAll("[data-experience-years]").forEach((el) => {
  const now = new Date();
  let years = now.getFullYear() - EXPERIENCE_START.getFullYear();
  if (
    now.getMonth() < EXPERIENCE_START.getMonth() ||
    (now.getMonth() === EXPERIENCE_START.getMonth() && now.getDate() < EXPERIENCE_START.getDate())
  ) {
    years -= 1;
  }
  const suffix = el.getAttribute("data-experience-years");
  el.textContent = `${years}+${suffix ? ` ${suffix}` : ""}`;
});

const syncHeader = () => {
  header?.classList.toggle("is-scrolled", window.scrollY > 10);
};

syncHeader();
window.addEventListener("scroll", syncHeader, { passive: true });

navToggle?.addEventListener("click", () => {
  const isOpen = nav?.classList.toggle("is-open") ?? false;
  header?.classList.toggle("is-open", isOpen);
  navToggle.setAttribute("aria-expanded", String(isOpen));
});

nav?.addEventListener("click", (event) => {
  if (event.target instanceof HTMLAnchorElement) {
    nav.classList.remove("is-open");
    header?.classList.remove("is-open");
    navToggle?.setAttribute("aria-expanded", "false");
  }
});

window.lucide?.createIcons();
