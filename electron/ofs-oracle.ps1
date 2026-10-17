# Lançamento das OFs na ordem de separação (F_ORDEMSEP.ORD_INFADC) — o mesmo que as planilhas
# "Inclusor da OF na NOTA FISCAL" (Matriz e Filial) fazem. Roda no PowerShell 32 bits, porque a
# conexão "Conexao" e o driver Oracle destes PCs são de 32 bits.
# A conexão (usuário e senha) é lida das próprias planilhas no L:, como o Excel faz: nada disso
# fica no código do app.
# Entrada: $env:RIPACK_OFS_ENTRADA = JSON em base64
#   { acao: 'buscar', codpros: [...], agrupas: [...], dias: 20 }
#   { acao: 'gravar', linhas: [{ empresa, agrupa, codigo, codpro, pedido, antes, novo }] }
# Saída (stdout): JSON { ok, linhas, resultados, erros }
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$entrada = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:RIPACK_OFS_ENTRADA)) | ConvertFrom-Json
$pasta = $env:RIPACK_OFS_PASTA
if (-not $pasta) { $pasta = 'L:\01 - Inclusor de OF' }
$planilhas = @{
  matriz = Join-Path $pasta 'Inclusor da OF na NOTA FISCAL - Matriz.xlsm'
  filial = Join-Path $pasta 'Inclusor da OF na NOTA FISCAL - Filial.xlsm'
}

# lê a conexão de dentro da planilha (xl/connections.xml), mesmo com ela aberta no Excel
function Ler-Conexao($arquivo) {
  if (-not (Test-Path -LiteralPath $arquivo)) { throw "Planilha não encontrada: $arquivo" }
  $fluxo = [IO.File]::Open($arquivo, 'Open', 'Read', 'ReadWrite')
  try {
    $zip = New-Object IO.Compression.ZipArchive($fluxo, [IO.Compression.ZipArchiveMode]::Read)
    $parte = $zip.GetEntry('xl/connections.xml')
    if (-not $parte) { throw "A planilha não tem conexão com o banco: $arquivo" }
    $leitor = New-Object IO.StreamReader($parte.Open())
    $xml = $leitor.ReadToEnd()
    $leitor.Close()
  } finally { $fluxo.Close() }
  $m = [regex]::Match($xml, 'connection="([^"]+)"')
  if (-not $m.Success) { throw "Conexão não encontrada na planilha: $arquivo" }
  $texto = [Net.WebUtility]::HtmlDecode($m.Groups[1].Value)
  $usuario = [regex]::Match($texto, 'UID=([^;]+)').Groups[1].Value
  if (-not $usuario) { throw "Usuário não encontrado na conexão da planilha: $arquivo" }
  return @{ texto = $texto; usuario = $usuario }
}

function Abrir($empresa) {
  $con = Ler-Conexao $planilhas[$empresa]
  $c = New-Object System.Data.Odbc.OdbcConnection($con.texto)
  $c.Open()
  return @{ conexao = $c; usuario = $con.usuario }
}

function Texto($v) { if ($v -is [DBNull] -or $null -eq $v) { return '' } return ([string]$v).Trim() }

$saida = @{ ok = $true; linhas = @(); resultados = @(); erros = @() }

if ($entrada.acao -eq 'buscar') {
  $codpros = @($entrada.codpros | Where-Object { $_ })
  $agrupas = @($entrada.agrupas | Where-Object { $_ })
  $dias = [int]$entrada.dias
  if ($dias -le 0) { $dias = 20 }
  foreach ($empresa in 'matriz', 'filial') {
    $a = $null
    try {
      $a = Abrir $empresa
      $u = $a.usuario
      $cmd = $a.conexao.CreateCommand()
      $condicoes = @()
      if ($codpros.Count) {
        $condicoes += "(O.ORD_CODPRO IN (" + (($codpros | ForEach-Object { '?' }) -join ',') + ") AND O.ORD_DTEMIS >= TRUNC(SYSDATE) - $dias)"
        foreach ($p in $codpros) { [void]$cmd.Parameters.AddWithValue('p', [string]$p) }
      }
      if ($agrupas.Count) {
        $condicoes += "O.ORD_AGRUPA IN (" + (($agrupas | ForEach-Object { '?' }) -join ',') + ")"
        foreach ($g in $agrupas) { [void]$cmd.Parameters.AddWithValue('g', [decimal]$g) }
      }
      if (-not $condicoes.Count) { continue }
      # quantidade: a enviada; com a OS ainda em coleta (status C) ela é 0 e vale a programada
      $cmd.CommandText = "SELECT O.ORD_AGRUPA, O.ORD_CODIGO, O.ORD_STATUS, TO_CHAR(O.ORD_DTEMIS, 'YYYY-MM-DD'), O.ORD_CODPRO, CASE WHEN NVL(O.ORD_QTDENV, 0) > 0 THEN O.ORD_QTDENV ELSE O.ORD_QTPROG END, O.ORD_NUMPED, O.ORD_INFADC FROM $u.F_ORDEMSEP O WHERE " + ($condicoes -join ' OR ')
      $r = $cmd.ExecuteReader()
      while ($r.Read()) {
        $saida.linhas += [pscustomobject]@{
          empresa = $empresa; agrupa = (Texto $r[0]); codigo = (Texto $r[1]); status = (Texto $r[2]); data = (Texto $r[3])
          codpro = (Texto $r[4]); qtd = $(if ($r[5] -is [DBNull]) { 0 } else { [double]$r[5] }); pedido = (Texto $r[6]); infadc = (Texto $r[7])
        }
      }
      $r.Close()
    } catch {
      $saida.erros += "${empresa}: " + $_.Exception.Message
    } finally { if ($a) { $a.conexao.Close() } }
  }
}
elseif ($entrada.acao -eq 'etiquetas') {
  # só leitura: os dados de cada etiqueta (código de barras) como o sistema guarda (V_ETIQUETAS)
  $codigos = @($entrada.codigos | Where-Object { $_ } | Select-Object -First 100)
  foreach ($empresa in 'matriz', 'filial') {
    if (-not $codigos.Count) { break }
    $a = $null
    try {
      $a = Abrir $empresa
      $u = $a.usuario
      $cmd = $a.conexao.CreateCommand()
      $cmd.CommandText = "SELECT ETIQUETA, EMPRESA, PRODUTO, CODPRO, QTDE, DETOF, CODIOF, TO_CHAR(DATA_REF, 'YYYY-MM-DD'), LOCEST, SALDO, ATIVA FROM $u.V_ETIQUETAS WHERE ETIQUETA IN (" + (($codigos | ForEach-Object { '?' }) -join ',') + ")"
      foreach ($cod in $codigos) { [void]$cmd.Parameters.AddWithValue('e', [string]$cod) }
      $r = $cmd.ExecuteReader()
      while ($r.Read()) {
        $saida.linhas += [pscustomobject]@{
          empresa = $empresa; etiqueta = (Texto $r[0]); cliente = (Texto $r[1]); produto = (Texto $r[2]); codpro = (Texto $r[3])
          qtd = $(if ($r[4] -is [DBNull]) { $null } else { [double]$r[4] }); of = $(if (Texto $r[5]) { Texto $r[5] } else { Texto $r[6] })
          data = (Texto $r[7]); local = (Texto $r[8]); saldo = $(if ($r[9] -is [DBNull]) { $null } else { [double]$r[9] }); ativa = (Texto $r[10])
        }
      }
      $r.Close()
      # o que já achou na Matriz não precisa procurar na Filial
      $achados = @($saida.linhas | ForEach-Object { $_.etiqueta })
      $codigos = @($codigos | Where-Object { $achados -notcontains $_ })
    } catch {
      $saida.erros += "${empresa}: " + $_.Exception.Message
    } finally { if ($a) { $a.conexao.Close() } }
  }
}
elseif ($entrada.acao -eq 'listarOs') {
  # só leitura: as OS ainda abertas no sistema — status C (coleta) e S (separada); E = encerrada fica de fora
  foreach ($empresa in 'matriz', 'filial') {
    $a = $null
    try {
      $a = Abrir $empresa
      $u = $a.usuario
      $cmd = $a.conexao.CreateCommand()
      $cmd.CommandText = "SELECT * FROM (SELECT O.ORD_AGRUPA, O.ORD_CODIGO, O.ORD_STATUS, TO_CHAR(O.ORD_DTEMIS, 'YYYY-MM-DD'), O.ORD_CODPRO, CASE WHEN NVL(O.ORD_QTDENV, 0) > 0 THEN O.ORD_QTDENV ELSE O.ORD_QTPROG END, O.ORD_NUMPED, O.ORD_INFADC, (SELECT MAX(I.AGI_MOTORI) FROM $u.F_AGRINF I WHERE I.AGI_AGRUPA = O.ORD_AGRUPA), (SELECT MAX(I.AGI_PLACAV) FROM $u.F_AGRINF I WHERE I.AGI_AGRUPA = O.ORD_AGRUPA), (SELECT MAX(P.PDV_CODEMP) FROM $u.F_PEDVENDA P WHERE P.PDV_NUMPED = O.ORD_NUMPED) FROM $u.F_ORDEMSEP O WHERE O.ORD_STATUS IN ('C', 'S') ORDER BY O.ORD_DTEMIS DESC, O.ORD_AGRUPA DESC, O.ORD_CODIGO) WHERE ROWNUM <= 800"
      $r = $cmd.ExecuteReader()
      while ($r.Read()) {
        $saida.linhas += [pscustomobject]@{
          empresa = $empresa; agrupa = (Texto $r[0]); codigo = (Texto $r[1]); status = (Texto $r[2]); data = (Texto $r[3])
          codpro = (Texto $r[4]); qtd = $(if ($r[5] -is [DBNull]) { 0 } else { [double]$r[5] }); pedido = (Texto $r[6]); infadc = (Texto $r[7])
          motorista = (Texto $r[8]); placa = (Texto $r[9]); codcli = (Texto $r[10])
        }
      }
      $r.Close()
    } catch {
      $saida.erros += "${empresa}: " + $_.Exception.Message
    } finally { if ($a) { $a.conexao.Close() } }
  }
}
elseif ($entrada.acao -eq 'saldo') {
  # só leitura: saldo de cada local de estoque do produto (saldo anterior + entradas - saídas)
  $codigo = ([string]$entrada.codigo).Trim().ToUpper()
  if ($codigo.Length -ge 4) {
    foreach ($empresa in 'matriz', 'filial') {
      $a = $null
      try {
        $a = Abrir $empresa
        $u = $a.usuario
        $cmd = $a.conexao.CreateCommand()
        $cmd.CommandText = "SELECT * FROM (SELECT E.EST_CODPRO, E.EST_LOCEST, L.LCE_DESCRI, NVL(E.EST_SLDANT, 0) + NVL(E.EST_QTENTR, 0) - NVL(E.EST_QTCONS, 0), TO_CHAR(E.EST_ULTINV, 'YYYY-MM-DD HH24:MI') FROM $u.F_ESTOQ E LEFT JOIN $u.F_LOCEST L ON L.LCE_CODIGO = E.EST_LOCEST WHERE UPPER(E.EST_CODPRO) LIKE ? ORDER BY E.EST_CODPRO, E.EST_LOCEST) WHERE ROWNUM <= 400"
        [void]$cmd.Parameters.AddWithValue('c', $codigo + '%')
        $r = $cmd.ExecuteReader()
        while ($r.Read()) {
          $saida.linhas += [pscustomobject]@{
            empresa = $empresa; codpro = (Texto $r[0]); local = (Texto $r[1]); descricao = (Texto $r[2])
            saldo = $(if ($r[3] -is [DBNull]) { 0 } else { [double]$r[3] }); atualizado = (Texto $r[4])
          }
        }
        $r.Close()
      } catch {
        $saida.erros += "${empresa}: " + $_.Exception.Message
      } finally { if ($a) { $a.conexao.Close() } }
    }
  }
}
elseif ($entrada.acao -eq 'gravar') {
  foreach ($empresa in 'matriz', 'filial') {
    $linhas = @($entrada.linhas | Where-Object { $_.empresa -eq $empresa })
    if (-not $linhas.Count) { continue }
    $a = $null
    try {
      $a = Abrir $empresa
      $u = $a.usuario
      foreach ($l in $linhas) {
        try {
          $cmd = $a.conexao.CreateCommand()
          # só grava se ninguém mudou a informação adicional desde a conferência
          $cmd.CommandText = "UPDATE $u.F_ORDEMSEP SET ORD_INFADC = ? WHERE ORD_AGRUPA = ? AND ORD_CODIGO = ? AND ORD_CODPRO = ? AND ORD_NUMPED = ? AND NVL(TRIM(ORD_INFADC), '#') = NVL(?, '#')"
          [void]$cmd.Parameters.AddWithValue('novo', [string]$l.novo)
          [void]$cmd.Parameters.AddWithValue('agrupa', [decimal]$l.agrupa)
          [void]$cmd.Parameters.AddWithValue('codigo', [decimal]$l.codigo)
          [void]$cmd.Parameters.AddWithValue('codpro', [string]$l.codpro)
          [void]$cmd.Parameters.AddWithValue('pedido', [string]$l.pedido)
          $antes = ([string]$l.antes).Trim()
          if ($antes) { [void]$cmd.Parameters.AddWithValue('antes', $antes) } else { [void]$cmd.Parameters.AddWithValue('antes', [DBNull]::Value) }
          $n = $cmd.ExecuteNonQuery()
          $saida.resultados += [pscustomobject]@{ chave = $l.chave; gravadas = $n }
        } catch {
          $saida.resultados += [pscustomobject]@{ chave = $l.chave; gravadas = 0; erro = $_.Exception.Message }
        }
      }
    } catch {
      $saida.erros += "${empresa}: " + $_.Exception.Message
      foreach ($l in $linhas) { $saida.resultados += [pscustomobject]@{ chave = $l.chave; gravadas = 0; erro = $_.Exception.Message } }
    } finally { if ($a) { $a.conexao.Close() } }
  }
}
else {
  $saida.ok = $false
  $saida.erros += "Ação desconhecida: $($entrada.acao)"
}

$saida | ConvertTo-Json -Depth 5 -Compress
