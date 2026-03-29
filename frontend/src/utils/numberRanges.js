const formatNumericLabel = (value) => {
  const rawValue = String(value ?? '').trim();
  if (!/^\d+$/.test(rawValue)) {
    return rawValue || '-';
  }

  return rawValue.padStart(Math.max(rawValue.length, 5), '0');
};

export const formatNumberRange = (startValue, endValue) => {
  const startLabel = formatNumericLabel(startValue);
  const endLabel = formatNumericLabel(endValue);

  if (!/^\d+$/.test(startLabel) || !/^\d+$/.test(endLabel)) {
    return `${startLabel} to ${endLabel}`;
  }

  const startNumber = Number(startLabel);
  const endNumber = Number(endLabel);
  const minLabel = formatNumericLabel(Math.min(startNumber, endNumber));
  const maxLabel = formatNumericLabel(Math.max(startNumber, endNumber));

  return `${minLabel} to ${maxLabel}`;
};

const getNumericValue = (value) => {
  const normalizedValue = String(value ?? '').trim();
  return /^\d+$/.test(normalizedValue) ? Number(normalizedValue) : null;
};

const compareSortableValues = (leftValue, rightValue) => {
  const leftNumericValue = getNumericValue(leftValue);
  const rightNumericValue = getNumericValue(rightValue);

  if (leftNumericValue !== null && rightNumericValue !== null) {
    return leftNumericValue - rightNumericValue;
  }

  return String(leftValue ?? '').localeCompare(String(rightValue ?? ''));
};

export const sortRowsForConsecutiveNumbers = (
  rows = [],
  getGroupingValues = () => [],
  getTimestampValue = (row) => row?.sentAt || row?.createdAt || row?.bookingDate || 0
) => [...rows].sort((leftRow, rightRow) => {
  const leftGroupingValues = getGroupingValues(leftRow);
  const rightGroupingValues = getGroupingValues(rightRow);
  const maxLength = Math.max(leftGroupingValues.length, rightGroupingValues.length);

  for (let index = 0; index < maxLength; index += 1) {
    const valueComparison = compareSortableValues(leftGroupingValues[index], rightGroupingValues[index]);
    if (valueComparison !== 0) {
      return valueComparison;
    }
  }

  const numberComparison = compareSortableValues(leftRow?.number, rightRow?.number);
  if (numberComparison !== 0) {
    return numberComparison;
  }

  const timestampComparison = new Date(getTimestampValue(leftRow) || 0).getTime() - new Date(getTimestampValue(rightRow) || 0).getTime();
  if (timestampComparison !== 0) {
    return timestampComparison;
  }

  return compareSortableValues(leftRow?.id || leftRow?._id || leftRow?.uniqueCode, rightRow?.id || rightRow?._id || rightRow?.uniqueCode);
});

export const getConsecutiveNumberCellMeta = (rows = [], getSignature = () => '') => {
  const metadata = Array.from({ length: rows.length }, () => ({
    showCell: true,
    rowSpan: 1,
    label: '-'
  }));

  let currentIndex = 0;

  while (currentIndex < rows.length) {
    const startRow = rows[currentIndex];
    const startValue = startRow?.number;
    const startNumericValue = getNumericValue(startValue);
    const signature = getSignature(startRow);
    let endIndex = currentIndex;
    let direction = 0;

    while (endIndex + 1 < rows.length) {
      const currentRow = rows[endIndex];
      const nextRow = rows[endIndex + 1];
      const currentNumericValue = getNumericValue(currentRow?.number);
      const nextNumericValue = getNumericValue(nextRow?.number);

      if (getSignature(nextRow) !== signature || currentNumericValue === null || nextNumericValue === null) {
        break;
      }

      const difference = nextNumericValue - currentNumericValue;
      if (Math.abs(difference) !== 1) {
        break;
      }

      if (direction === 0) {
        direction = difference;
      }

      if (difference !== direction) {
        break;
      }

      endIndex += 1;
    }

    const endValue = rows[endIndex]?.number;
    metadata[currentIndex] = {
      showCell: true,
      rowSpan: endIndex - currentIndex + 1,
      label: startNumericValue === null
        ? formatNumberRange(startValue, startValue)
        : formatNumberRange(startValue, endValue)
    };

    for (let index = currentIndex + 1; index <= endIndex; index += 1) {
      metadata[index] = {
        showCell: false,
        rowSpan: 0,
        label: ''
      };
    }

    currentIndex = endIndex + 1;
  }

  return metadata;
};

export const groupConsecutiveNumberRows = (rows = [], getSignature = () => '') => {
  const groups = [];
  let currentIndex = 0;

  while (currentIndex < rows.length) {
    const startRow = rows[currentIndex];
    const signature = getSignature(startRow);
    let endIndex = currentIndex;
    let direction = 0;

    while (endIndex + 1 < rows.length) {
      const currentRow = rows[endIndex];
      const nextRow = rows[endIndex + 1];
      const currentNumericValue = getNumericValue(currentRow?.number);
      const nextNumericValue = getNumericValue(nextRow?.number);

      if (getSignature(nextRow) !== signature || currentNumericValue === null || nextNumericValue === null) {
        break;
      }

      const difference = nextNumericValue - currentNumericValue;
      if (Math.abs(difference) !== 1) {
        break;
      }

      if (direction === 0) {
        direction = difference;
      }

      if (difference !== direction) {
        break;
      }

      endIndex += 1;
    }

    const groupRows = rows.slice(currentIndex, endIndex + 1);
    groups.push({
      rows: groupRows,
      firstRow: groupRows[0],
      lastRow: groupRows[groupRows.length - 1],
      label: formatNumberRange(groupRows[0]?.number, groupRows[groupRows.length - 1]?.number)
    });

    currentIndex = endIndex + 1;
  }

  return groups;
};
