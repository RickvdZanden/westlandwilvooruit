// Openbare instellingen. Trainers werken zonder wachtwoord, dus de pagina praat
// rechtstreeks met Supabase. De publishable key mag publiek: wat iemand zonder
// account mag, is in de database vastgelegd met Row Level Security (alleen lezen
// en een oefening als concept insturen; de admin keurt goed). Zet hier NOOIT een secret/service key.
// Inloggen als admin gaat via /inlog/ (e-mail + wachtwoord + TOTP); er staat geen admin-adres of wachtwoord in de code.
window.TB_CONFIG = {
  supabaseUrl: "https://aeeqkcnaqilttqppljmj.supabase.co",
  supabaseKey: "sb_publishable_yL6M_IHO5uGPmBa7e8oERQ_-DYbnmPD"
};
