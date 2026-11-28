// Compare subito al tocco di una voce della barra, mentre la pagina si prepara.
export default function AdminLoading() {
  return (
    <section className="sa-page sa-loading" role="status" aria-label="Caricamento">
      <div className="sa-skeleton" data-size="title" />
      <div className="sa-skeleton" />
      <div className="sa-skeleton" />
    </section>
  );
}
