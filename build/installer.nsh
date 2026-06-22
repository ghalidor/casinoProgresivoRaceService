; ============================================================
; Cierra "Admin Progresivo Race" antes de instalar o actualizar.
; La app corre en segundo plano (bandeja) y no se cierra sola,
; por eso aqui la forzamos a cerrar para poder reemplazar el .exe.
; Se ejecuta al inicio del instalador, antes de copiar archivos.
; ============================================================
!macro customInit
  nsExec::Exec 'taskkill /F /IM "Admin Progresivo Race.exe" /T'
  Pop $0
!macroend
