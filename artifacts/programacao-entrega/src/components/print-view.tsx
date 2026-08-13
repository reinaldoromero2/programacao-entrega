import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Entrega } from "@workspace/api-client-react";

interface PrintViewProps {
  entregas: Entrega[];
  date: string;
}

export function PrintView({ entregas, date }: PrintViewProps) {
  const parsedDate = new Date(date + "T12:00:00");
  const dayLabel = format(parsedDate, "dd/MM/yyyy");
  const weekDay  = format(parsedDate, "EEEE", { locale: ptBR });
  const weekDayCap = weekDay.charAt(0).toUpperCase() + weekDay.slice(1);

  const rows = [...entregas].sort((a, b) =>
    a.sortOrder !== b.sortOrder ? a.sortOrder - b.sortOrder : a.id - b.id
  );

  return (
    <div className="print-page">
      {/* Header — matches PDF exactly */}
      <div className="print-heading">PROGRAMAÇÃO DE ENTREGA</div>
      <div className="print-subheading">{dayLabel} — {weekDayCap}</div>

      {/* Main table */}
      <table className="print-table">
        <thead>
          <tr className="print-header-row">
            <th className="print-th print-col-num">#</th>
            <th className="print-th print-col-cliente">CLIENTE</th>
            <th className="print-th print-col-hrs">HRS</th>
            <th className="print-th print-col-obs">OBS</th>
            <th className="print-th print-col-motorista">MOTORISTA • PLACA</th>
            <th className="print-th print-col-v">V</th>
            <th className="print-th print-col-unidade">UNIDADE</th>
            <th className="print-th print-col-nf">NF</th>
            <th className="print-th print-col-cg">CG</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e, i) => (
            <tr key={e.id} className={i % 2 === 1 ? "print-row print-row-alt" : "print-row"}>
              <td className="print-td print-td-center">{i + 1}</td>
              <td className="print-td print-td-bold">{e.cliente}</td>
              <td className="print-td print-td-center">{e.hrs ?? ""}</td>
              <td className="print-td">{e.obs ?? ""}</td>
              <td className="print-td print-td-small">
                {[e.motorista, e.placa].filter(Boolean).join(" • ")}
              </td>
              <td className="print-td print-td-center">{e.v ?? ""}</td>
              <td className="print-td print-td-center">{e.unidade}</td>
              <td className="print-td print-td-center">
                {e.nf && e.nf !== "none" ? "✓" : ""}
              </td>
              <td className="print-td print-td-center">
                {e.cg && e.cg !== "none" ? "✓" : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
