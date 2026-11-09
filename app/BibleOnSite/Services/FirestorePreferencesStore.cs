#if ANDROID || IOS
using System.Collections;
using Plugin.Firebase.Firestore;
#if ANDROID
using Plugin.Firebase.Firestore.Platforms.Android;
using Plugin.Firebase.Firestore.Platforms.Android.Extensions;
#elif IOS
using Foundation;
using Plugin.Firebase.Firestore.Platforms.iOS;
using Plugin.Firebase.Firestore.Platforms.iOS.Extensions;
#endif

namespace BibleOnSite.Services;

/// <summary>
/// Firestore-backed <see cref="IPreferencesCloudStore"/> (#1095): one document
/// per user at <c>users/{uid}</c>, read/written as a plain dictionary so no
/// reflection serialization is needed under AOT. The security rules in
/// <c>app/firebase/firestore.rules</c> scope the path to
/// <c>request.auth.uid == userId</c>.
///
/// The Firestore SDK itself queues writes offline and retries, so failures
/// here mean genuinely unreachable state — the sync service keeps local
/// values and retries on the next change.
/// </summary>
public sealed class FirestorePreferencesStore : IPreferencesCloudStore
{
    private const string UsersCollection = "users";

    private static IDocumentReference DocumentFor(string userId)
    {
        var firestore = CrossFirebaseFirestore.Current;
#if FIREBASE_EMULATOR
        // Emulator-gated builds (#3185): UseEmulator must run before the
        // first document call on the Firestore singleton.
        FirebaseEmulatorRouting.ApplyToFirestore(firestore);
#endif
        return firestore.GetDocument($"{UsersCollection}/{userId}");
    }

    public async Task<PreferencesCloudDocument?> FetchAsync(string userId, CancellationToken cancellationToken)
    {
        var snapshot = await DocumentFor(userId)
            .GetDocumentSnapshotAsync<Dictionary<string, object>>()
            .WaitAsync(cancellationToken);
#if ANDROID
        var map = ReadAndroidDocument(snapshot);
#elif IOS
        var map = ReadIosDocument(snapshot);
#endif
        return PreferencesCloudCodec.FromFirestoreMap(map);
    }

    public async Task SaveAsync(string userId, PreferencesCloudDocument document, CancellationToken cancellationToken)
    {
        // Merge(), not a plain set: only the fields this device merged are
        // written, so keys another device saved between our fetch and this
        // write survive instead of being overwritten by a stale snapshot.
        await DocumentFor(userId)
            .SetDataAsync(PreferencesCloudCodec.ToFirestoreMap(document), SetOptions.Merge())
            .WaitAsync(cancellationToken);
    }

#if ANDROID
    // Plugin.Firebase.Firestore 4.0.0's IDocumentSnapshot<T>.Data casts the
    // native map to T as a POCO: Dictionary<string,object> carries no
    // [FirestoreProperty] members, so every read materialized an empty map
    // and remote entries never reached the merge (#3185's device run caught
    // it — the production path had the same silent-empty read). Read the
    // platform wrapper's raw Java map and convert it to managed
    // dictionaries/lists/scalars that PreferencesCloudCodec parses.
    private static IDictionary? ReadAndroidDocument(IDocumentSnapshot<Dictionary<string, object>> snapshot)
    {
        var raw = (snapshot as DocumentSnapshotWrapper)?.Wrapped.Data;
        return raw == null ? null : (IDictionary)ConvertAndroidNode(raw)!;
    }

    private static object? ConvertAndroidNode(object? node) => node switch
    {
        null => null,
        string or bool or int or long or double => node,
        float f => (double)f,
        Java.Lang.ICharSequence text => text.ToString(),
        Java.Lang.Boolean b => b.BooleanValue(),
        Java.Lang.Integer i => i.IntValue(),
        Java.Lang.Long l => l.LongValue(),
        Java.Lang.Double d => d.DoubleValue(),
        Java.Lang.Float f => (double)f.FloatValue(),
        Java.Util.Date date => date.ToDateTimeOffset(),
        global::Firebase.Timestamp timestamp => timestamp.ToDate().ToDateTimeOffset(),
        Java.Util.IMap map => ConvertAndroidMap(map),
        IDictionary dictionary => ConvertAndroidPairs(dictionary),
        IEnumerable sequence => ConvertAndroidList(sequence),
        // Unknown native types stay unconverted — the codec's canonical-value
        // check drops them instead of inventing a bogus string preference.
        _ => node,
    };

    private static Dictionary<string, object?> ConvertAndroidMap(Java.Util.IMap map)
    {
        var result = new Dictionary<string, object?>();
        var keys = map.KeySet();
        if (keys is null)
        {
            return result;
        }
        foreach (var key in keys)
        {
            if (key is not Java.Lang.Object javaKey)
            {
                continue;
            }
            var keyString = javaKey.ToString();
            if (keyString is null)
            {
                continue;
            }
            result[keyString] = ConvertAndroidNode(map.Get(javaKey));
        }
        return result;
    }

    // JavaDictionary's non-generic IEnumerable yields KeyValuePair<K,V>
    // (not DictionaryEntry), while managed dictionaries yield
    // DictionaryEntry — handle both shapes.
    private static Dictionary<string, object?> ConvertAndroidPairs(IEnumerable pairs)
    {
        var result = new Dictionary<string, object?>();
        foreach (var item in pairs)
        {
            object? key;
            object? value;
            switch (item)
            {
                case DictionaryEntry entry:
                    key = entry.Key;
                    value = entry.Value;
                    break;
                case null:
                    continue;
                default:
                {
                    var type = item.GetType();
                    if (!type.IsGenericType || type.GetGenericTypeDefinition() != typeof(KeyValuePair<,>))
                    {
                        continue;
                    }
                    key = type.GetProperty("Key")?.GetValue(item);
                    value = type.GetProperty("Value")?.GetValue(item);
                    break;
                }
            }
            if (key?.ToString() is { } keyString)
            {
                result[keyString] = ConvertAndroidNode(value);
            }
        }
        return result;
    }

    private static List<object?> ConvertAndroidList(IEnumerable sequence)
    {
        var result = new List<object?>();
        foreach (var item in sequence)
        {
            result.Add(ConvertAndroidNode(item));
        }
        return result;
    }
#elif IOS
    // Same Plugin.Firebase 4.0.0 gap as Android: IDocumentSnapshot<T>.Data
    // POCO-casts the NSDictionary, so Dictionary<string,object> always came
    // back empty. Convert the raw NSDictionary/NSArray/NSString/NSNumber
    // tree into the managed shapes PreferencesCloudCodec parses.
    private static IDictionary? ReadIosDocument(IDocumentSnapshot<Dictionary<string, object>> snapshot)
    {
        var raw = (snapshot as DocumentSnapshotWrapper)?.Wrapped.Data;
        return raw == null ? null : (IDictionary)ConvertIosNode((NSObject?)raw)!;
    }

    private static object? ConvertIosNode(NSObject? node) => node switch
    {
        null => null,
        NSNull => null,
        NSString text => text.ToString(),
        NSNumber number => ConvertIosNumber(number),
        NSDate date => new DateTimeOffset(DateTime.SpecifyKind((DateTime)date, DateTimeKind.Utc)),
        global::Firebase.CloudFirestore.Timestamp timestamp => timestamp.ToDateTimeOffset(),
        NSDictionary dictionary => ConvertIosMap(dictionary),
        NSArray array => ConvertIosList(array),
        _ => node,
    };

    // Firestore writes bools, int64s and doubles; ObjCType tells them apart
    // (CFBoolean toll-free-bridges to "c", modern _Bool is "B").
    private static object ConvertIosNumber(NSNumber number) => number.ObjCType switch
    {
        "B" or "c" or "?" => number.BoolValue,
        "d" => number.DoubleValue,
        "f" => (double)number.FloatValue,
        "Q" or "L" => number.UInt64Value,
        "q" or "l" => number.Int64Value,
        "I" => number.UInt32Value,
        "i" => number.Int32Value,
        "S" => number.UInt16Value,
        "s" => number.Int16Value,
        "C" => number.ByteValue,
        _ => number,
    };

    private static Dictionary<string, object?> ConvertIosMap(NSDictionary dictionary)
    {
        var result = new Dictionary<string, object?>();
        var keys = dictionary.AllKeys;
        for (nuint i = 0; i < keys.Count; i++)
        {
            if (keys.GetItem<NSString>(i) is not { } key)
            {
                continue;
            }
            result[key.ToString()] = ConvertIosNode(dictionary.ObjectForKey(key));
        }
        return result;
    }

    private static List<object?> ConvertIosList(NSArray array)
    {
        var result = new List<object?>();
        for (nuint i = 0; i < array.Count; i++)
        {
            result.Add(ConvertIosNode(array.GetItem<NSObject>(i)));
        }
        return result;
    }
#endif
}
#endif
