import ExcelJS from "exceljs";
import { resolveListoneAdapter, resolveVotesAdapter } from "../lib/adapters";
import { parseFantacalcioGrades, votesForClubs } from "../lib/server/fantacalcio-live";
import { calculateProvisional } from "../lib/engine/calculator";

async function bufferOf(build: (book: ExcelJS.Workbook) => void) {
  const book = new ExcelJS.Workbook();
  build(book);
  return Buffer.from(await book.xlsx.writeBuffer());
}

async function main() {
const listone = resolveListoneAdapter();
const quotations = await listone.parse({ bytes: await bufferOf((book) => {
  const tutti = book.addWorksheet("Tutti");
  tutti.addRow(["Id", "R", "RM", "Nome", "Squadra"]);
  tutti.addRow([101, "P", "Por", "Marco Sportiello", "Atalanta"]);
  tutti.addRow([102, "A", "Pc", "Lautaro Martinez", "Inter"]);
  tutti.addRow([103, "C", "M", "Vecchio", "Genoa"]);
  const ceduti = book.addWorksheet("Ceduti");
  ceduti.addRow(["Id", "R", "Nome", "Squadra"]);
  ceduti.addRow([103, "C", "Vecchio", "Genoa"]);
}) });

if (quotations.active.length !== 2 || quotations.released.length !== 1) {
  throw new Error(`Listone inatteso: ${JSON.stringify(quotations)}`);
}
if (quotations.active[0]?.role !== "GK" || quotations.active[1]?.role !== "FWD") {
  throw new Error(`Ruoli inattesi: ${JSON.stringify(quotations.active)}`);
}

const serieA = await listone.parse({ bytes: await bufferOf((book) => {
  const tutti = book.addWorksheet("Tutti");
  tutti.getCell("A1").value = "Id";
  tutti.getCell("B1").value = "R";
  tutti.getCell("C1").value = "RM";
  tutti.getCell("D1").value = "Nome";
  tutti.getCell("E1").value = "Squadra";
  tutti.getCell("A2").value = 201;
  tutti.getCell("B2").value = "C";
  tutti.getCell("C2").value = "A";
  tutti.getCell("D2").value = "Franco Mastantuono";
  tutti.getCell("E2").value = "Real Madrid";
  tutti.getCell("A3").value = 202;
  tutti.getCell("B3").value = "A";
  tutti.getCell("C3").value = "C";
  tutti.getCell("D3").value = "Punta";
  tutti.getCell("E3").value = "Inter";
}) });
const mastantuono = serieA.active.find((player) => player.name === "Franco Mastantuono");
const punta = serieA.active.find((player) => player.name === "Punta");
if (mastantuono?.role !== "MID" || mastantuono.clubName !== "Real Madrid" || punta?.role !== "FWD") {
  throw new Error(`Ruolo di colonna B inatteso: ${JSON.stringify(serieA.active)}`);
}

const voteAdapter = resolveVotesAdapter();
const votes = await voteAdapter.parse({ bytes: await bufferOf((book) => {
  const sheet = book.addWorksheet("Fantacalcio");
  const atalanta = sheet.addRow(["Atalanta"]);
  sheet.mergeCells(atalanta.number, 1, atalanta.number, 13);
  sheet.addRow(["Cod.", "Ruolo", "Nome", "Voto", "Gf", "Gs", "Rp", "Rs", "Rf", "Au", "Amm", "Esp", "Ass"]);
  sheet.addRow([101, "P", "Marco Sportiello", "6*", 0, 1, 0, 0, 1, 0, 1, 0, 0]);
  sheet.addRow([104, "D", "Senza voto", null, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  sheet.addRow([1909, "ALL", "Palladino", 6.5, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const inter = sheet.addRow(["Inter"]);
  sheet.mergeCells(inter.number, 1, inter.number, 13);
  sheet.addRow(["Cod.", "Ruolo", "Nome", "Voto", "Gf", "Gs", "Rp", "Rs", "Rf", "Au", "Amm", "Esp", "Ass"]);
  sheet.addRow([102, "A", "Lautaro Martinez", 7.5, 1, 0, 0, 0, 0, 0, 0, 0, 1]);
  const other = book.addWorksheet("Statistico");
  other.addRow(["Cod.", "Ruolo", "Nome", "Voto", "Gf", "Gs", "Rp", "Rs", "Rf", "Au", "Amm", "Esp", "Ass"]);
  other.addRow([104, "D", "Senza voto", 6.5, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
  other.addRow([102, "A", "Lautaro Martinez", 4, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
}) });

if (votes.votes.length !== 2 || votes.skippedWithoutVote !== 1) {
  throw new Error(`Voti inattesi: ${JSON.stringify(votes)}`);
}
if (votes.votes[0]?.voto !== 6 || votes.votes[0]?.goalsConceded !== 1 || votes.votes[0]?.clubName !== "Atalanta" || votes.votes[1]?.assists !== 1) {
  throw new Error(`Dettaglio voti inatteso: ${JSON.stringify(votes.votes)}`);
}
if (votes.votes.some((row) => row.externalRef === "104" || row.name === "Palladino")) {
  throw new Error(`Entrato un voto vuoto o un allenatore: ${JSON.stringify(votes.votes)}`);
}

const provisional = calculateProvisional(
  "team",
  "gw",
  [
    { playerId: "gk", isCaptain: false, isVice: false },
    { playerId: "att", isCaptain: true, isVice: false },
    { playerId: "still", isCaptain: false, isVice: true },
  ],
  new Map([
    ["gk", { playerId: "gk", role: "GK", voto: 6, goalsConceded: 1, yellowCards: 1 }],
    ["att", { playerId: "att", role: "FWD", voto: 7.5, goals: 1, assists: 0 }],
    ["still", { playerId: "still", role: "MID", voto: null }],
  ]),
  { lineup_size: 11, empty_slot_points: 2.5, fair_play: { points: 2.5 }, captain_modifier: [{ eq: 7.5, points: 2 }] },
  new Set(["gk"]),
);

if (provisional.ratedPlayersCount !== 2 || provisional.onPitchCount !== 1) {
  throw new Error(`Conteggi live inattesi: ${provisional.ratedPlayersCount}/${provisional.onPitchCount}`);
}
if (provisional.fairPlay !== 0) {
  throw new Error("Il fair play non deve scattare con un titolare ancora in campo.");
}
if (provisional.reservePoints !== 20) {
  throw new Error(`Riserva inattesa: ${provisional.reservePoints}`);
}

const grades = parseFantacalcioGrades(`
<tr>
  <td><a class="player-name player-link" href="https://www.fantacalcio.it/serie-a/squadre/udinese/okoye/6462"><span>Okoye</span></a></td>
  <td>
    <span class="player-grade " data-value="5,5"></span>
    <span class="player-grade " data-value="56"></span>
  </td>
  <td>
    <span class="player-bonus cell malus" data-value="0"></span>
    <span class="player-bonus cell malus" data-value="2"></span>
    <span class="player-bonus cell malus" data-value="0"></span>
    <span class="player-bonus cell bonus" data-value="0"></span>
    <span class="player-bonus cell malus" data-value="0"></span>
    <span class="player-bonus cell bonus" data-value="0"></span>
    <span class="player-bonus cell bonus" data-value="0"></span>
  </td>
</tr>
<tr>
  <td><a class="player-name player-link" href="https://www.fantacalcio.it/serie-a/squadre/venezia/panchina/999"><span>Panchina</span></a></td>
  <td><span class="player-grade " data-value="56"></span></td>
</tr>`);
const udinese = votesForClubs(grades, "venezia", "udinese");
if (udinese.length !== 1 || udinese[0]?.voto !== 5.5 || udinese[0]?.goalsConceded !== 2) {
  throw new Error(`Voto live inatteso: ${JSON.stringify(udinese)}`);
}

console.log("parser e live score ok", {
  active: quotations.active.length,
  released: quotations.released.length,
  votes: votes.votes.map((row) => [row.externalRef, row.voto, row.clubName]),
  provisional: provisional.provisionalTotal,
  rated: provisional.ratedPlayersCount,
  onPitch: provisional.onPitchCount,
});
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
