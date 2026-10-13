import { Component, type ReactNode } from "react";

// Se alguma parte da tela der erro, mostra a mensagem e um "Recarregar" em vez de deixar a janela
// em branco (antes um único campo com dado inesperado derrubava o app inteiro sem dizer nada).
export class ErroNaTela extends Component<{ children: ReactNode }, { erro: Error | null }> {
  state = { erro: null as Error | null };

  static getDerivedStateFromError(erro: Error) {
    return { erro };
  }

  componentDidCatch(erro: Error) {
    console.error("[ErroNaTela]", erro);
  }

  render() {
    if (!this.state.erro) return this.props.children;
    return (
      <div style={{ padding: 32, fontFamily: "Segoe UI, system-ui, sans-serif", color: "#1e293b", maxWidth: 720, margin: "40px auto" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#243776", marginBottom: 12 }}>A tela não conseguiu abrir</h1>
        <p style={{ fontSize: 15, marginBottom: 12 }}>
          Clique em "Recarregar". Se continuar, tire um print desta mensagem e mande para quem cuida do app.
        </p>
        <pre style={{ background: "#f1f5f9", padding: 12, borderRadius: 8, fontSize: 12, whiteSpace: "pre-wrap", marginBottom: 16 }}>
          {String(this.state.erro?.message || this.state.erro)}
        </pre>
        <button
          type="button"
          onClick={() => location.reload()}
          style={{ background: "#243776", color: "#fff", border: 0, borderRadius: 8, padding: "10px 20px", fontSize: 15, cursor: "pointer" }}
        >
          Recarregar
        </button>
      </div>
    );
  }
}
