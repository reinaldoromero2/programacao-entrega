// Campo OF/OBS com texto maior do que cabe: abre uma caixa grande para ler e digitar (como o
// "Editar divergências" da Programação). Só a OF (ex.: 257436) cabe no campo e segue normal.
// Vale para o formulário do romaneio, o assistente e a calculadora (Carga Fácil).
(function () {
  var SELETOR = '.ofobs-input, .wiz-item-ofobs, .cf-item-of';
  var aberto = null; // { campo, overlay }

  function naoCabe(campo) {
    // só a OF (o número, com ou sem "OF:") segue no campo, mesmo apertada
    if (/^\s*(OF\s*:?\s*)?\d+\s*$/i.test(campo.value)) return false;
    return campo.scrollWidth > campo.clientWidth + 2;
  }

  // escreve no campo original e avisa a página (ela guarda o valor no evento "input")
  function passarParaCampo(campo, valor) {
    var set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(campo, valor.replace(/\s*\n+\s*/g, ' '));
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function fechar() {
    if (!aberto) return;
    var campo = aberto.campo;
    if (aberto.overlay.parentNode) aberto.overlay.parentNode.removeChild(aberto.overlay);
    aberto = null;
    // volta o foco ao campo sem reabrir a caixa, até a pessoa sair dele
    campo._campoGrandeSegurar = true;
    try { campo.focus(); campo.setSelectionRange(campo.value.length, campo.value.length); } catch (e) { /* campo sumiu */ }
    campo.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function abrir(campo) {
    if (aberto || campo.disabled || campo.readOnly) return;
    var overlay = document.createElement('div');
    overlay.className = 'rom-modal-overlay';
    overlay.style.zIndex = '600';
    overlay.innerHTML =
      '<div class="rom-modal-card" style="max-width:640px; width:min(640px, 94vw);">' +
        '<div class="rom-modal-head" style="display:flex; align-items:center; justify-content:space-between;">' +
          '<h3 style="margin:0;">OF/OBS</h3>' +
          '<button type="button" class="campo-grande-x" aria-label="Fechar" style="background:none; border:0; font-size:22px; line-height:1; cursor:pointer; color:var(--text-secondary);">×</button>' +
        '</div>' +
        '<textarea class="campo-grande-texto" rows="5" style="width:100%; box-sizing:border-box; margin-top:10px; font-family:inherit; font-size:16px; line-height:1.4; padding:10px 12px; border-radius:10px; resize:vertical;"></textarea>' +
        '<p class="foot-note" style="margin:6px 0 0;">Enter ou × para concluir.</p>' +
      '</div>';
    var raiz = document.querySelector('.app-root') || document.body;
    raiz.appendChild(overlay);
    var texto = overlay.querySelector('.campo-grande-texto');
    texto.value = campo.value;
    aberto = { campo: campo, overlay: overlay };
    texto.addEventListener('input', function () { passarParaCampo(campo, texto.value); });
    texto.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === 'Escape') { ev.preventDefault(); fechar(); }
    });
    overlay.querySelector('.campo-grande-x').addEventListener('click', fechar);
    overlay.addEventListener('mousedown', function (ev) { if (ev.target === overlay) fechar(); });
    setTimeout(function () { texto.focus(); texto.setSelectionRange(texto.value.length, texto.value.length); }, 0);
  }

  function talvezAbrir(ev) {
    var campo = ev.target;
    if (!campo || !campo.matches || !campo.matches(SELETOR)) return;
    if (campo._campoGrandeSegurar) return;
    if (naoCabe(campo)) abrir(campo);
  }
  // ao entrar no campo já cheio, ou quando o texto digitado passa do tamanho do campo
  document.addEventListener('focusin', talvezAbrir);
  document.addEventListener('input', talvezAbrir);
  document.addEventListener('focusout', function (ev) {
    if (ev.target && ev.target.matches && ev.target.matches(SELETOR)) ev.target._campoGrandeSegurar = false;
  });
})();
