/**
 * Modal de confirmação próprio — substitui o confirm() nativo do navegador,
 * que destoa da interface e é ruim de usar em telas touch.
 *
 * Uso: const ok = await confirmar('Título', 'Explicação...', { textoConfirmar: 'Remover', perigo: true });
 */
let overlay = null;

function garantirModal() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'modalConfirmar';
    overlay.innerHTML = `
        <div class="modal-box" role="alertdialog" aria-modal="true" aria-labelledby="confirmar-titulo">
            <h3 id="confirmar-titulo"></h3>
            <p id="confirmar-texto" class="confirmar-texto"></p>
            <div class="modal-botoes">
                <button type="button" class="btn btn-secundario" id="confirmar-cancelar">Cancelar</button>
                <button type="button" class="btn btn-principal" id="confirmar-ok">Confirmar</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    return overlay;
}

export function confirmar(titulo, texto = '', { textoConfirmar = 'Confirmar', perigo = false } = {}) {
    const modal = garantirModal();
    modal.querySelector('#confirmar-titulo').textContent = titulo;
    modal.querySelector('#confirmar-texto').textContent = texto;

    const btnOk = modal.querySelector('#confirmar-ok');
    const btnCancelar = modal.querySelector('#confirmar-cancelar');
    btnOk.textContent = textoConfirmar;
    btnOk.className = perigo ? 'btn btn-perigo-solido' : 'btn btn-principal';

    modal.style.display = 'flex';
    btnCancelar.focus();

    return new Promise((resolve) => {
        function fechar(resultado) {
            modal.style.display = 'none';
            btnOk.removeEventListener('click', aoConfirmar);
            btnCancelar.removeEventListener('click', aoCancelar);
            modal.removeEventListener('click', aoClicarFora);
            document.removeEventListener('keydown', aoTeclar);
            resolve(resultado);
        }
        function aoConfirmar() { fechar(true); }
        function aoCancelar() { fechar(false); }
        function aoClicarFora(ev) { if (ev.target === modal) fechar(false); }
        function aoTeclar(ev) { if (ev.key === 'Escape') fechar(false); }

        btnOk.addEventListener('click', aoConfirmar);
        btnCancelar.addEventListener('click', aoCancelar);
        modal.addEventListener('click', aoClicarFora);
        document.addEventListener('keydown', aoTeclar);
    });
}
