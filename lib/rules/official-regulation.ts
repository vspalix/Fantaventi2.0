import { BONUS_FIELDS, type LeagueRules } from "@/lib/league-rules";

function signed(value: number) {
  const digits = Number.isInteger(value) ? 0 : 1;
  const text = Math.abs(value).toLocaleString("it-IT", {
    minimumFractionDigits: digits,
    maximumFractionDigits: 2,
  });
  if (value > 0) return `+${text}`;
  if (value < 0) return `−${text}`;
  return text;
}

export function buildOfficialRegulation(leagueName: string, rules: LeagueRules) {
  const bonusRows = BONUS_FIELDS.map((field) => {
    const value = rules.bonusEnabled[field.key] === false ? 0 : rules.bonusMalus[field.key];
    const note = field.key === "goal_conceded" ? "Solo il portiere" : "Chi ha un voto";
    return `| ${field.label} | ${signed(value)} | ${note} |`;
  }).join("\n");

  const defense = rules.defenseEnabled
    ? "In questa lega il modificatore difesa è **attivo**."
    : "In questa lega il modificatore difesa è **spento**.";
  const captain = !rules.captainEnabled
    ? "Il bonus capitano è **spento**: né fascia né moltiplicatore."
    : rules.captainMultiplier === 1
      ? "Il capitano prende la **fascia sul voto** pubblicato."
      : `Il capitano moltiplica i propri fantapunti per **${rules.captainMultiplier.toLocaleString("it-IT")}**. La fascia sul voto non si somma.`;
  const forgotten = rules.missedLineup === "penalty"
    ? `Chi non invia la formazione prende **${rules.missedLineupPenalty}** punti in quella giornata, al posto della rosa.`
    : "Chi non invia la formazione riceve d'ufficio l'ultima formazione inviata. Alla prima giornata, se non ne ha ancora una, il sistema schiera la rosa in ordine alfabetico: gli 11 titolari di un modulo ammesso e la panchina, entrambi dalla A alla Z.";
  const cleanSheet = rules.cleanSheetEnabled
    ? `L'imbattibilità del portiere vale **${signed(rules.cleanSheetPoints)}** se ha un voto e non subisce gol.`
    : "L'imbattibilità del portiere è **spenta**.";
  const postponed = rules.postponement === "political_six"
    ? "In questa lega una partita rinviata assegna il **6 politico**."
    : "In questa lega una partita rinviata resta in **attesa del recupero**: niente 6 politico.";
  const formatName = rules.format === "h2h"
    ? "Scontri diretti: i fantapunti diventano gol con le soglie della lega, poi 3 punti alla vittoria, 1 al pareggio e 0 alla sconfitta."
    : rules.format === "hybrid"
      ? "Fasi: la regular season segue il formato scelto e la coppa resta fuori da quella classifica."
      : "Classifica a somma: ogni giornata aggiunge i fantapunti.";
  const roseShare = rules.exclusiveRosters
    ? "In questa lega le rose sono esclusive: lo stesso calciatore non può stare in due squadre."
    : "Le rose non sono esclusive: più squadre della stessa lega possono scegliere lo stesso calciatore.";
  const checkpointLines = rules.checkpoints.length === 0
    ? "Non ci sono checkpoint. La rosa si modifica quando non c'è una giornata in corso."
    : rules.checkpoints
      .map((item) => `- Dopo la giornata **${item.afterMatchday}**: massimo **${item.changes}** cambi, fino alla chiusura della giornata successiva.`)
      .join("\n");
  const late = rules.enrollment === "closed"
    ? "La lega è a iscrizioni chiuse: non c'è ingresso in media."
    : "La lega è aperta. Chi entra dopo la prima giornata, per le giornate già chiuse prima del suo ingresso, riceve la media di tutti i partecipanti su quelle giornate. Una squadra senza punteggio conta zero. Dalla sua prima formazione in poi somma solo i propri punti.";

  return `# Regolamento ufficiale

Regolamento di **${leagueName}**. I numeri sono quelli con cui il motore calcola questa lega. Il testo salvato qui è quello che leggono i partecipanti.

## 1. Formato

${formatName}

## 2. La rosa

- Nessun credito e nessuna asta. Si scelgono i calciatori del listone.
- Massimo **un calciatore per club** della competizione.
- La rosa è di **20** calciatori. I portieri sono da **2** a **3**. Difensori, centrocampisti e attaccanti sono, per ogni ruolo, da **3** a **9**, oppure i limiti del regolamento di stagione se diversi.
- ${roseShare}

## 3. Checkpoint di mercato

${checkpointLines}

Durante un checkpoint ogni cambio rispetta di nuovo il vincolo di un calciatore per club e i limiti di ruolo.

## 4. Formazione e deadline

- Si schierano **11** titolari più la panchina ordinata. I moduli ammessi sono 3-4-3, 3-5-2, 4-3-3, 4-4-2, 4-5-1, 5-3-2 e 5-4-1.
- La formazione si può rispedire fino al minuto prima della deadline. L'ultimo invio valido sostituisce il precedente, senza una seconda scheda.
- La deadline è **un minuto prima** del primo calcio d'inizio della giornata. Dopo, la formazione non si modifica.
- ${forgotten}

## 5. Quando una partita è chiusa

- Una partita entra nel calcolo **130 minuti** dopo il calcio d'inizio.
- Resta aperta finché i voti di quella partita non sono stati salvati sul listone.
- Se i voti non sono ancora pubblicati, o se i codici del tabellino non sono nel listone, la partita non viene chiusa.

## 6. Voti e fonte

- La fonte è la pagina pubblica di **Fantacalcio.it**, una per giornata, senza account.
- Non sono un voto: \`s.v.\`, \`sv\`, \`n.d.\`, \`-\` e \`56\`. Il \`6*\` vale 6. La virgola italiana è il decimale.
- Un senza voto non porta né bonus né malus, anche se sul tabellino compaiono ammonizione, assist o autogol.
- L'amministratore può caricare i voti da Excel quando la pagina non li ha ancora pubblicati.

## 7. Sostituzioni e riserva d'ufficio

Per ogni titolare senza voto pubblicato, a partita chiusa:

1. Entra il primo della panchina con lo **stesso ruolo** e con un voto. I senza voto in mezzo vengono saltati, anche se sono più di uno di fila.
2. Se nessun pari ruolo ha voto, entra il primo panchinaro di ruolo diverso che lascia in campo un modulo ammesso. Il portiere non si scambia con un movimento.
3. Se la panchina è esaurita, lo slot vale la **riserva d'ufficio di 2,5**. Lo stesso 2,5 vale per ogni titolare mancante sotto gli 11.

La proiezione di una giornata in corso somma solo i fantavoti già pubblicati. Non fa entrare la panchina, non assegna la riserva e non applica i modificatori di squadra. Chi non ha ancora un voto resta in campo e vale zero.

## 8. Portiere senza voto

- Gol subiti e rigori parati di un portiere senza voto **non creano un voto** e non si sommano a nessun altro.
- Se in panchina c'è un portiere con voto, entra lui e si calcola la sua pagella, non gli eventi di chi è rimasto fuori.
- Un movimento non può sostituire il portiere. Senza un portiere votato lo slot è vuoto (2,5) e il modificatore difesa non parte.

## 9. Bonus e malus

Il fantavoto è voto + bonus + malus. Senza voto pubblicato il fantavoto non esiste.

| Voce | Punti | Quando |
| --- | --- | --- |
${bonusRows}

Il gol e il rigore segnato sono due voci distinte, come le pubblica Fantacalcio. Nel calcolo ufficiale il malus del capitano effettivo è raddoppiato. I bonus no. Nella proiezione il malus resta quello della voce: un'ammonizione è −0,5, un gol +3, un gol subito dal portiere −1.

## 10. Capitano e vice

La fascia si legge sul **voto pubblicato**, non sul fantavoto.

| Voto pubblicato | Fascia |
| --- | --- |
| sotto 6 | −0,5 |
| 6 | +0,5 |
| 6,5 | +1 |
| 7 | +1,5 |
| da 7,5 in su | +2 |

- Un voto del capitano fuori da queste fasce blocca la pubblicazione della giornata.
- Se il capitano non ha voto e il vice è in campo con un voto, la fascia passa al vice e il malus raddoppiato è il suo.
- Nella proiezione la fascia del capitano non si applica. Entra solo nel calcolo ufficiale, insieme alle sostituzioni di fine giornata.
- Il 6 politico non è un voto pubblicato: **non fa scattare la fascia**.

## 11. Modificatore difesa

${defense}

${captain}

${cleanSheet}

Quando è attivo serve un portiere con voto e **almeno 4 difensori con voto**. La media è il voto del portiere più i **3 voti** migliori dei difensori. Si usa il voto, non il fantavoto.

| Media | Punti |
| --- | --- |
| da 7 | +6 |
| da 6,5 | +3 |
| da 6 | +1 |
| sotto 6 | 0 |

Un 6 politico conta come voto 6. Entra in media solo se è tra i tre migliori. Se è il quarto difensore votato, serve a far scattare il modificatore ma non abbassa la media dei tre. Nella proiezione questo modificatore vale zero.

## 12. Fair play

- Con almeno un giocatore votato e **nessuna ammonizione** tra i votati, la squadra prende **+2,5**.
- Un'ammonizione lo azzera. Un'espulsione da sola no.
- L'ammonizione di un senza voto uscito dal campo non conta.
- Nella proiezione il fair play non si applica. Resta nel calcolo ufficiale.
- Un 6 politico non porta il malus dell'ammonizione. Se però l'ammonizione è indicata, il fair play la vede.

## 13. Partite rinviate

${postponed}

Le due regole possibili sono queste.

- **6 politico.** Il rinviato, finché la partita non è chiusa e non ha un voto pubblicato, prende 6. Bonus e malus restano a zero. Il 6 entra nei punti e, per portiere e difensori, nel modificatore difesa.
- **Attesa del recupero.** Lo stesso giocatore resta senza voto. Non prende il 6 e non vale come riserva finché la partita è rinviata.
- Se la partita risulta chiusa e il voto non c'è, non scatta il 6 politico: si usa la sostituzione o la riserva d'ufficio.

## 14. Audit e congelamento

Quando viene chiusa l'ultima partita della giornata, il sistema rilegge **tutte** le partite di quella giornata, aggiorna le differenze e calcola le formazioni. La giornata passa a calcolata: quei punti sono il risultato.

Dopo **24 ore** la giornata diventa definitiva e non si ricalcola.

## 15. Ingresso in corso

${late}
`;
}
