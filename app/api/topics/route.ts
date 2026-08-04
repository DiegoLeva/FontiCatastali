import { NextResponse } from "next/server";
import { getIndice } from "@/lib/classify";
import { TASSONOMIA, type TaxNode } from "@/lib/taxonomy";
import type { TopicNode, TopicsResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// L'albero cambia solo quando cambia il corpus: cache CDN 1h.
export const revalidate = 3600;

/**
 * Albero degli argomenti con i conteggi.
 *
 * I nodi senza documenti vengono esclusi: nella mappa sarebbero vicoli ciechi.
 * Il loro numero viene comunque riportato in `nodiVuoti`, perche' e' la misura
 * che dice quali rami del lessico vanno tarati.
 */
export async function GET(): Promise<NextResponse<TopicsResponse>> {
  try {
    const idx = await getIndice();
    let vuoti = 0;

    const build = (node: TaxNode): TopicNode | null => {
      const count = idx.perNodo.get(node.id)?.length ?? 0;
      if (count === 0) {
        // Conta il ramo intero come vuoto, senza scendere oltre.
        const conta = (n: TaxNode): number =>
          1 + n.figli.reduce((s, c) => s + conta(c), 0);
        vuoti += conta(node);
        return null;
      }
      const figli = node.figli
        .map(build)
        .filter((c): c is TopicNode => c !== null)
        .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
      return { id: node.id, label: node.label, count, figli };
    };

    const aree = TASSONOMIA.map(build)
      .filter((a): a is TopicNode => a !== null)
      .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));

    return NextResponse.json({
      totale: idx.totale,
      classificati: idx.classificati,
      residuo: idx.totale - idx.classificati,
      nodiVuoti: vuoti,
      aree,
    });
  } catch (err) {
    console.error("[/api/topics] errore:", err);
    return NextResponse.json(
      {
        totale: 0,
        classificati: 0,
        residuo: 0,
        nodiVuoti: 0,
        aree: [],
        error: "Impossibile costruire la mappa degli argomenti.",
      },
      { status: 500 }
    );
  }
}
