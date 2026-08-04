import { NextRequest, NextResponse } from "next/server";
import { getIndice } from "@/lib/classify";
import {
  LABEL_RESIDUO,
  NODI,
  NODO_RESIDUO,
  percorso,
} from "@/lib/taxonomy";
import type { TopicCrumb, TopicDocsResponse } from "@/lib/types";

export const runtime = "nodejs";
export const revalidate = 3600;

const PAGE_SIZE = 60;

function vuota(id: string, msg: string, status: number) {
  return NextResponse.json<TopicDocsResponse>(
    { id, label: "", percorso: [], totale: 0, docs: [], error: msg },
    { status }
  );
}

/** Documenti di un nodo (discendenti inclusi), paginati. */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse<TopicDocsResponse>> {
  const id = decodeURIComponent(params.id);
  const isResiduo = id === NODO_RESIDUO;
  const nodo = NODI.get(id);

  if (!isResiduo && !nodo) return vuota(id, "Argomento inesistente.", 404);

  const offset = Math.max(
    0,
    Number(req.nextUrl.searchParams.get("offset") ?? 0) || 0
  );

  try {
    const idx = await getIndice();
    const tutti = idx.perNodo.get(id) ?? [];
    const crumbs: TopicCrumb[] = isResiduo
      ? [{ id: NODO_RESIDUO, label: LABEL_RESIDUO }]
      : percorso(id).map((p) => ({ id: p.id, label: p.label }));

    return NextResponse.json({
      id,
      label: isResiduo ? LABEL_RESIDUO : nodo!.label,
      percorso: crumbs,
      totale: tutti.length,
      docs: tutti.slice(offset, offset + PAGE_SIZE),
    });
  } catch (err) {
    console.error(`[/api/topics/${id}] errore:`, err);
    return vuota(id, "Impossibile caricare i documenti.", 500);
  }
}
