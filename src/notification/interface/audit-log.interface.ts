interface ChangeDetail {
  column: string;       // Nombre de la columna
  oldValue: any;        // Valor anterior
  newValue: any;
  changes?:any;
  // Valor nuevo
}

interface EntityChanges {
  [column: string]: ChangeDetail;
}
