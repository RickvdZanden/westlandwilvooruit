// Openbare instellingen. Trainers werken zonder wachtwoord, dus de pagina praat
// rechtstreeks met Supabase. De publishable key mag publiek: wat iemand zonder
// account mag, is in de database vastgelegd met Row Level Security (alleen lezen
// en een concept-oefening voorstellen). Zet hier NOOIT een secret/service key.
// Het admin-wachtwoord staat nergens in de code; alleen het adres van het admin-account.
window.TB_CONFIG = {
  supabaseUrl: "https://aeeqkcnaqilttqppljmj.supabase.co",
  supabaseKey: "sb_publishable_yL6M_IHO5uGPmBa7e8oERQ_-DYbnmPD",
  adminEmail: "admin@training.westlandwilvooruit.nl"
};
