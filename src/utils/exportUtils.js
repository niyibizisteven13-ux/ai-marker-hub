export function exportGradebookToCSV(gradedResultsList) {
  if (!gradedResultsList || gradedResultsList.length === 0) {
    console.warn("No evaluated results available to export.");
    return;
  }

  let csvContent = "data:text/csv;charset=utf-8,";
  csvContent += "Assessment Title,Student ID,Student Name,Total Score,Max Score,Percentage (%)\r\n";

  gradedResultsList.forEach((res) => {
    const maxScore = res.maxPossibleScore || 1;
    const percentage = ((res.totalAwardedScore / maxScore) * 100).toFixed(1);
    
    const row = [
      `"${res.assessmentTitle || 'General Assessment'}"`,
      `"${res.studentId || 'N/A'}"`,
      `"${res.studentName || 'Unknown Student'}"`,
      res.totalAwardedScore ?? 0,
      maxScore,
      `${percentage}%`
    ];
    
    csvContent += row.join(",") + "\r\n";
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `Gradebook_Matrix_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
