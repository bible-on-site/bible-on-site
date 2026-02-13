# Perushim Priority Ordering

## Overview

The perushim (commentaries) are displayed in a specific order that follows the legacy app's design:

1. **Targum variants** (תרגום) - always first
2. **Rashi** (רש"י) - always second
3. **All other commentaries** - chronological by composition date

## Implementation

Priority values are assigned at data generation time in `src/data/extract.rs`:

### Priority Ranges

| Range | Commentary Type | Ordering Within Range |
|-------|----------------|----------------------|
| 0-99  | Targum (תרגום) variants | Chronological (by comp_date year) |
| 100   | Rashi (רש"י) | Fixed priority |
| 200+  | All others | Chronological (200 + comp_date year) |
| 9999  | Unknown/missing dates | Last |

### Examples

Based on Sefaria data:

- **תרגום** - compDate `[0, 600]` → priority **0**
- **תרגום אונקלוס** - compDate `[80, 120]` → priority **80**
- **תרגום יונתן** - compDate `[150, 250]` → priority **99** (capped)
- **תרגום ירושלמי** - compDate `[380, 1180]` → priority **99** (capped)
- **רש"י** - compDate `[1075, 1105]` → priority **100** (special rule)
- **בכור שור** - compDate `[1145, 1195]` → priority **1345** (200 + 1145)
- **רשב"ם** - compDate `[1120, 1160]` → priority **1320** (200 + 1120)
- **אבן עזרא** - compDate `[1155, 1165]` → priority **1355** (200 + 1155)

## Query Behavior

The SQL query orders by:
```sql
ORDER BY p.priority ASC, note_count DESC
```

This ensures:
1. All Targum variants appear first (priority 0-99)
2. Rashi always appears after Targum but before all others (priority 100)
3. Other commentaries appear chronologically (priority 200+)
4. Within same priority, commentaries with more notes appear first

## Legacy Comparison

This matches the legacy Flutter app ordering logic from:
`legacy-app/lib/viewmodel/al_haperek/perek_extra_view_model.dart`

```dart
int Function(String a, String b) perushIdComparator = (perushIdA, perushIdB) {
  if (perushIdA.contains("תרגום")) return -2;
  if (perushIdB.contains("תרגום")) return 2;
  if (perushIdA.contains("רש\"י")) return -1;
  if (perushIdB.contains("רש\"י")) return 1;
  return compareAsciiUpperCase(perushIdA, perushIdB);
};
```

## Regenerating Data

After modifying the priority logic:

1. Run the perushim pipeline to regenerate data:
   ```bash
   cd data/sefaria/pipelines/perushim-view
   cargo run -- <command>
   ```

2. The new priority values will be automatically applied to:
   - SQLite catalog (for app bundle)
   - MySQL database (for API)
   - JSON exports (for testing)

## Testing

Verify ordering by checking:
1. Targum variants appear first in the perushim list
2. Rashi appears immediately after all Targum variants
3. Other commentaries appear in chronological order
4. No changes to display logic are needed - everything is driven by the `priority` field
