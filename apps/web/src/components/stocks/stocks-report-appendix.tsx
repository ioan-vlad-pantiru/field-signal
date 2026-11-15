import { COUNTRIES, fmtDays, type CountryCode } from "@/lib/stocks";
import { ReportSection, Table, num, pct, tonnes, yesNo, type ReportData } from "./stocks-report-ui";

/** Every country that appears in a recommended split, fastest first. */
function splitCountries(data: ReportData): CountryCode[] {
  const codes = new Set(data.short.flatMap((i) => i.allocation.lines.map((l) => l.country)));
  return [...codes].sort((x, y) => COUNTRIES[x].lead_days - COUNTRIES[y].lead_days);
}

/** 5. How the goods would travel from each recommended country. */
export function LogisticsSection({ data }: { data: ReportData }) {
  return (
    <ReportSection n={5} title="Logistică">
      <p>
        Țările din împărțirile recomandate. Timpii de livrare sunt estimări tipice până la fabricile din România, nu oferte
        ferme.
      </p>
      <Table
        head={["Țara", "Rută", "Livrare (zile)", "UE", "Schengen", "Cale ferată 1520 mm", "Dunăre", "Monedă"]}
        numeric={[2]}
        rows={splitCountries(data).map((code) => {
          const f = COUNTRIES[code];
          return [f.name.ro, f.route.ro, num(f.lead_days), yesNo(f.eu), yesNo(f.schengen), yesNo(f.gauge_1520), yesNo(f.danube), f.currency];
        })}
      />
    </ReportSection>
  );
}

interface Risk {
  title: string;
  action: string;
  affected: string[];
}

/** Deduplicated risks of the recommended splits, each with what it affects. */
function risks(data: ReportData): Risk[] {
  const lines = data.short.flatMap(({ a, allocation }) =>
    allocation.lines.map((l) => ({ a, l, f: COUNTRIES[l.country] })),
  );
  const names = (keep: (x: (typeof lines)[number]) => boolean, label = (x: (typeof lines)[number]) => x.f.name.ro) => [
    ...new Set(lines.filter(keep).map(label)),
  ];
  const list: Risk[] = [
    {
      title: "Livrare după epuizarea stocului",
      action: "Cumpărați o cantitate-punte de la un furnizor apropiat până sosește livrarea principală.",
      affected: names(
        (x) => x.f.lead_days > x.a.cover_days,
        (x) => `${x.a.row.name.ro}: ${x.f.name.ro} (~${fmtDays(x.f.lead_days, "ro")}; stoc ~${fmtDays(Math.floor(x.a.cover_days), "ro")})`,
      ),
    },
    {
      title: "Concentrare pe o singură țară",
      action: "Peste jumătate din volum depinde de o singură țară; negociați o sursă de rezervă.",
      affected: names(
        // Same rule as allocate(): more than half the shortfall, rounded up.
        (x) => x.l.tonnes > Math.ceil(x.a.shortfall_t / 2),
        (x) => `${x.a.row.name.ro}: ${x.f.name.ro} (${pct(x.l.share * 100)})`,
      ),
    },
    {
      title: "Volum neacoperit",
      action: "Prognozele conservatoare nu acoperă deficitul; folosiți ingrediente alternative sau ajustați rețetele.",
      affected: data.short
        .filter((i) => i.allocation.uncovered_t > 0)
        .map((i) => `${i.a.row.name.ro}: ${tonnes(i.allocation.uncovered_t)}`),
    },
    {
      title: "Secetă corelată",
      action: "Aceeași zonă climatică ca România: seceta care ne lovește le reduce și lor recolta. Nu bazați tot volumul pe aceste țări.",
      affected: names((x) => x.f.shared_drought),
    },
    {
      title: "Război și transport la Marea Neagră",
      action: "Contracte cu clauze de livrare și o sursă de rezervă pregătită.",
      affected: names((x) => x.f.war_risk),
    },
    {
      title: "Restricții la export",
      action: "Au restricționat exporturile în 2022; prevedeți în contract ce se întâmplă dacă restricțiile revin.",
      affected: names((x) => x.f.export_curbs_2022),
    },
    {
      title: "Soia modificată genetic și EUDR",
      action: "Cereți certificare non-MG și diligența EUDR privind defrișările.",
      affected: names((x) => x.a.row.id === "soy_meal" && x.f.gm_soy),
    },
    {
      title: "Expunere valutară",
      action: "Plăți în altă monedă decât euro: contracte în EUR sau acoperire valutară.",
      affected: names(
        (x) => x.f.currency !== "EUR",
        (x) => `${x.f.name.ro} (${x.f.currency})`,
      ),
    },
    ...splitCountries(data).flatMap((code) => {
      const note = COUNTRIES[code].note;
      return note ? [{ title: `Notă de țară: ${COUNTRIES[code].name.ro}`, action: note.ro, affected: [COUNTRIES[code].name.ro] }] : [];
    }),
  ];
  return list.filter((r) => r.affected.length > 0);
}

/** 6. What could go wrong with the recommendation. */
export function RisksSection({ data }: { data: ReportData }) {
  const list = risks(data);
  return (
    <ReportSection n={6} title="Riscuri și alte probleme">
      <p>Riscurile privesc țările din împărțirile recomandate. Fiecare apare o singură dată, cu tot ce afectează.</p>
      {list.length === 0 ? (
        <p>Nu au fost identificate riscuri pentru împărțirile recomandate.</p>
      ) : (
        <ol className="flex flex-col gap-2.5">
          {list.map((r, i) => (
            <li key={r.title} className="break-inside-avoid border-b border-neutral-300 pb-2.5">
              <p className="font-semibold">
                <span className="mr-2 text-neutral-500">{i + 1}.</span>
                {r.title}
              </p>
              <p className="mt-0.5">{r.action}</p>
              <p className="mt-0.5 text-[9pt] text-neutral-600">Afectează: {r.affected.join("; ")}</p>
            </li>
          ))}
        </ol>
      )}
    </ReportSection>
  );
}

/** 7. Appendix: the heading only; its content was removed. */
export function AnnexSection() {
  return (
    <ReportSection newPage n={7} title="Anexă — date, ipoteze, încredere, rolul AI">
      {null}
    </ReportSection>
  );
}
