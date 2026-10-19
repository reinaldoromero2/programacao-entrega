# Acrescenta auditorias na planilha "Lista de Auditorias de Processo - Expedição.xlsx" pelo próprio
# Excel (mantém a formatação). Uma aba por mês ("Outubro 2026"); aba nova é cópia da mais recente,
# só com o cabeçalho. Não repete linha que já está lá (mesma Data + RP + Cliente + OF).
# Entrada: env RIPACK_AUD_ENTRADA = base64 de JSON { arquivo, linhas: [{ data:'AAAA-MM-DD', auditado, rp, cliente, of, equip, venc:'AAAA-MM-DD', obs }] }
# Saída: uma linha JSON { ok, acrescentadas, jaTinha, erro }
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$saida = [ordered]@{ ok = $false; acrescentadas = 0; jaTinha = 0; erro = '' }
$excel = $null; $wb = $null
try {
  $entrada = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:RIPACK_AUD_ENTRADA)) | ConvertFrom-Json
  $arquivo = [string]$entrada.arquivo
  if (-not (Test-Path -LiteralPath $arquivo)) { throw "Planilha não encontrada: $arquivo" }
  # aberta no Excel de alguém (ou no OneDrive sincronizando): não dá para gravar agora
  try { $f = [IO.File]::Open($arquivo, 'Open', 'ReadWrite', 'None'); $f.Close() } catch { throw 'A planilha está aberta em outro programa (feche o Excel e tente de novo).' }
  $meses = @('Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro')
  function DataBr($iso) { $p = ([string]$iso).Split('-'); return $p[2] + '/' + $p[1] + '/' + $p[0] }
  function Txt($v) { if ($null -eq $v) { return '' } ; return ([string]$v).Trim() }
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $wb = $excel.Workbooks.Open($arquivo)
  # ordena por data mantendo a ordem de entrada dentro do mesmo dia
  $n = 0
  $ordenadas = @($entrada.linhas | ForEach-Object { [pscustomobject]@{ k = ([string]$_.data) + '|' + ('{0:D4}' -f $n); l = $_ }; $n++ } | Sort-Object k | ForEach-Object { $_.l })
  foreach ($l in $ordenadas) {
    $p = ([string]$l.data).Split('-')
    $nomeAba = $meses[[int]$p[1] - 1] + ' ' + $p[0]
    $ws = $null
    foreach ($s in $wb.Worksheets) { if ($s.Name -eq $nomeAba) { $ws = $s } }
    if (-not $ws) {
      # copia a última aba (cabeçalho, larguras, cores) e apaga as linhas de dados
      $ultima = $wb.Worksheets.Item($wb.Worksheets.Count)
      $ultima.Copy([Type]::Missing, $ultima)
      $ws = $wb.Worksheets.Item($wb.Worksheets.Count)
      $ws.Name = $nomeAba
      $usadas = $ws.UsedRange.Rows.Count
      if ($usadas -gt 1) { $ws.Range("A2:L$usadas").ClearContents() | Out-Null }
    }
    # última linha preenchida na coluna A
    $fim = $ws.Cells.Item($ws.Rows.Count, 1).End(-4162).Row
    $serial = (Get-Date -Year ([int]$p[0]) -Month ([int]$p[1]) -Day ([int]$p[2])).Date.ToOADate()
    $existe = $false
    for ($r = 2; $r -le $fim; $r++) {
      $d = $ws.Cells.Item($r, 1).Value2
      if ($d -is [double] -and [math]::Abs($d - $serial) -lt 0.5 -and (Txt $ws.Cells.Item($r, 5).Text) -eq (Txt $l.rp) -and (Txt $ws.Cells.Item($r, 6).Text) -eq (Txt $l.cliente) -and (Txt $ws.Cells.Item($r, 7).Text) -eq (Txt $l.of)) { $existe = $true; break }
    }
    if ($existe) { $saida.jaTinha++; continue }
    $r = $fim + 1
    # mesma formatação da linha de cima (bordas, fonte): copia a linha inteira e depois troca os valores
    if ($fim -ge 2) { $ws.Rows.Item($fim).Copy($ws.Rows.Item($r)) | Out-Null }
    $dia = [int]$p[2]; $mes = [int]$p[1]; $ano = [int]$p[0]
    $ws.Cells.Item($r, 1).Value2 = (Get-Date -Year $ano -Month $mes -Day $dia).Date.ToOADate()
    $ws.Cells.Item($r, 2).Value2 = 'Facilitador'
    $ws.Cells.Item($r, 3).Value2 = 'Reinaldo'
    $ws.Cells.Item($r, 4).Value2 = [string](Txt $l.auditado)
    $ws.Cells.Item($r, 5).NumberFormat = '@'; $ws.Cells.Item($r, 5).Value2 = [string](Txt $l.rp)
    $ws.Cells.Item($r, 6).Value2 = [string](Txt $l.cliente)
    $ws.Cells.Item($r, 7).NumberFormat = '@'; $ws.Cells.Item($r, 7).Value2 = [string](Txt $l.of)
    $ws.Cells.Item($r, 8).Value2 = 'Unidade I'
    $ws.Cells.Item($r, 9).Value2 = 'Expedição'
    $ws.Cells.Item($r, 10).NumberFormat = '@'; $ws.Cells.Item($r, 10).Value2 = [string]$(if (Txt $l.equip) { Txt $l.equip } else { "2256" })
    $v = $(if (Txt $l.venc) { ([string]$l.venc).Split('-') } else { @('2026','10','31') })
    $ws.Cells.Item($r, 11).Value2 = (Get-Date -Year ([int]$v[0]) -Month ([int]$v[1]) -Day ([int]$v[2])).Date.ToOADate()
    $ws.Cells.Item($r, 12).Value2 = [string](Txt $l.obs)
    $saida.acrescentadas++
  }
  if ($saida.acrescentadas -gt 0) { $wb.Save() }
  $saida.ok = $true
} catch {
  $saida.erro = $_.Exception.Message + " (linha " + $_.InvocationInfo.ScriptLineNumber + ")"
} finally {
  if ($wb) { $wb.Close($false) | Out-Null }
  if ($excel) { $excel.Quit() | Out-Null; [Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null }
}
$saida | ConvertTo-Json -Compress
