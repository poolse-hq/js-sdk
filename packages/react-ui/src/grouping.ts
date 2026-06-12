// Re-export of the shared grouping helpers (originally lived here;
// hoisted into @poolse/react so the React Native package can share
// the same logic without duplicating it). Web-only consumers
// importing from this path keep working.
export {
  computeGroupPosition,
  sameGroup,
  sameDay,
  formatDayLabel,
  type GroupPosition,
} from '@poolse/react';
