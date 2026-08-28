export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export const todayKST = () => {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
};
