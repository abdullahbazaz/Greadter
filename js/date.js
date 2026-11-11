// Today's date in the top bar, like the date written at the top of an exercise-book page.
// Fills every <time class="today"> and rolls over at midnight, even if the tab stays open.
(function(){
  function render(){
    const now = new Date();
    const long = now.toLocaleDateString(undefined, { weekday:"short", day:"numeric", month:"short", year:"numeric" });
    const short = now.toLocaleDateString(undefined, { day:"numeric", month:"short" });
    const iso = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
    document.querySelectorAll("time.today").forEach(el=>{
      el.dateTime = iso;
      el.innerHTML = `<span class="today-long">${long}</span><span class="today-short">${short}</span>`;
    });
  }
  function scheduleMidnight(){
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
    setTimeout(()=>{ render(); scheduleMidnight(); }, next - now);
  }
  render();
  scheduleMidnight();
  // Sleeping laptops can miss the timer; re-check whenever the tab comes back.
  document.addEventListener("visibilitychange", ()=>{ if(!document.hidden) render(); });
})();
