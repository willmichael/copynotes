import {
  List,
  ActionPanel,
  Action,
  Clipboard,
  Icon,
  getSelectedText,
  useNavigation,
  Form,
  LocalStorage,
  showToast,
  Toast,
} from "@raycast/api";
import { useEffect, useState } from "react";

const BUCKET_COUNT = 5;
const STORAGE_KEY = "copy-notes-buckets";

interface Bucket {
  id: number;
  name: string;
  items: string[];
}

function defaultBuckets(): Bucket[] {
  return Array.from({ length: BUCKET_COUNT }, (_, i) => ({ id: i, name: "", items: [] }));
}

async function loadBuckets(): Promise<Bucket[]> {
  const stored = await LocalStorage.getItem<string>(STORAGE_KEY);
  if (!stored) return defaultBuckets();
  const parsed = JSON.parse(stored) as Bucket[];
  while (parsed.length < BUCKET_COUNT) parsed.push({ id: parsed.length, name: "", items: [] });
  return parsed.slice(0, BUCKET_COUNT);
}

async function saveBuckets(buckets: Bucket[]): Promise<void> {
  await LocalStorage.setItem(STORAGE_KEY, JSON.stringify(buckets));
}

function truncate(text: string, max = 60): string {
  const single = text.replace(/\n/g, " ").trim();
  return single.length <= max ? single : single.substring(0, max) + "...";
}

function bucketMarkdown(bucket: Bucket): string {
  if (bucket.items.length === 0) return "_Empty_";
  return bucket.items
    .map((item, i) => `**${i + 1}.** ${item.replace(/\n/g, " ").trim()}`)
    .join("\n\n");
}

function BucketNameForm({
  initialName,
  onSubmit,
}: {
  initialName?: string;
  onSubmit: (name: string) => void;
}) {
  const { pop } = useNavigation();
  return (
    <Form
      navigationTitle={initialName ? "Rename Bucket" : "Name Your Bucket"}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={initialName ? "Rename" : "Create Bucket"}
            onSubmit={(values: { name: string }) => {
              if (values.name.trim()) {
                onSubmit(values.name.trim());
                pop();
              }
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="name"
        title="Bucket Name"
        placeholder="e.g. Work, Personal, Links..."
        defaultValue={initialName}
        autoFocus
      />
    </Form>
  );
}

function BucketItemsView({
  bucket,
  onRemove,
}: {
  bucket: Bucket;
  onRemove: (text: string) => void;
}) {
  return (
    <List navigationTitle={bucket.name} searchBarPlaceholder="Type a number to jump...">
      {bucket.items.map((text, i) => (
        <List.Item
          key={i}
          icon={Icon.Clipboard}
          title={`${i + 1}. ${text.replace(/\n/g, " ").trim()}`}
          keywords={[String(i + 1)]}
          actions={
            <ActionPanel>
              <Action
                title="Paste"
                icon={Icon.Clipboard}
                onAction={async () => {
                  await Clipboard.paste(text);
                  await showToast({ style: Toast.Style.Success, title: "Pasted" });
                }}
              />
              <Action
                title="Copy"
                icon={Icon.CopyClipboard}
                onAction={async () => {
                  await Clipboard.copy(text);
                  await showToast({ style: Toast.Style.Success, title: "Copied" });
                }}
              />
              <Action
                title="Remove from Bucket"
                icon={Icon.Trash}
                style={Action.Style.Destructive}
                onAction={() => onRemove(text)}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

export default function Command() {
  const [uncategorized, setUncategorized] = useState<string[]>([]);
  const [buckets, setBuckets] = useState<Bucket[]>(defaultBuckets());
  const [isLoading, setIsLoading] = useState(true);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const { push } = useNavigation();

  function toggleSelection(text: string) {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      next.has(text) ? next.delete(text) : next.add(text);
      return next;
    });
  }

  async function init() {
    setIsLoading(true);
    try {
      const selected = await getSelectedText();
      if (selected) await Clipboard.copy(selected);
    } catch {
      // nothing selected
    }

    const history: string[] = [];
    for (let offset = 0; offset < 5; offset++) {
      try {
        const { text } = await Clipboard.read({ offset });
        if (text) history.push(text);
      } catch {
        // no item at this offset
      }
    }

    const storedBuckets = await loadBuckets();
    const bucketed = new Set(storedBuckets.flatMap((b) => b.items));
    setUncategorized(history.filter((t) => !bucketed.has(t)));
    setBuckets(storedBuckets);
    setIsLoading(false);
  }

  useEffect(() => {
    init();
  }, []);

  async function moveToExistingBucket(text: string, bucketId: number) {
    const updated = buckets.map((b) =>
      b.id === bucketId ? { ...b, items: [text, ...b.items.filter((i) => i !== text)] } : b
    );
    setBuckets(updated);
    setUncategorized((prev) => prev.filter((i) => i !== text));
    await saveBuckets(updated);
    await showToast({ style: Toast.Style.Success, title: `Moved to "${updated[bucketId].name}"` });
  }

  async function moveToNewBucket(text: string, bucketId: number, name: string) {
    const updated = buckets.map((b) =>
      b.id === bucketId ? { ...b, name, items: [text, ...b.items.filter((i) => i !== text)] } : b
    );
    setBuckets(updated);
    setUncategorized((prev) => prev.filter((i) => i !== text));
    await saveBuckets(updated);
    await showToast({ style: Toast.Style.Success, title: `Created "${name}" and added item` });
  }

  async function renameBucket(bucketId: number, name: string) {
    const updated = buckets.map((b) => (b.id === bucketId ? { ...b, name } : b));
    setBuckets(updated);
    await saveBuckets(updated);
    await showToast({ style: Toast.Style.Success, title: `Renamed to "${name}"` });
  }

  async function moveBulkToExistingBucket(bucketId: number) {
    const texts = [...selectedItems];
    const updated = buckets.map((b) =>
      b.id === bucketId
        ? { ...b, items: [...texts, ...b.items.filter((i) => !selectedItems.has(i))] }
        : b
    );
    setBuckets(updated);
    setUncategorized((prev) => prev.filter((i) => !selectedItems.has(i)));
    setSelectedItems(new Set());
    await saveBuckets(updated);
    await showToast({
      style: Toast.Style.Success,
      title: `Moved ${texts.length} items to "${updated[bucketId].name}"`,
    });
  }

  async function moveBulkToNewBucket(bucketId: number, name: string) {
    const texts = [...selectedItems];
    const updated = buckets.map((b) =>
      b.id === bucketId
        ? { ...b, name, items: [...texts, ...b.items.filter((i) => !selectedItems.has(i))] }
        : b
    );
    setBuckets(updated);
    setUncategorized((prev) => prev.filter((i) => !selectedItems.has(i)));
    setSelectedItems(new Set());
    await saveBuckets(updated);
    await showToast({
      style: Toast.Style.Success,
      title: `Moved ${texts.length} items to "${name}"`,
    });
  }

  async function removeFromBucket(text: string, bucketId: number) {
    const updated = buckets.map((b) =>
      b.id === bucketId ? { ...b, items: b.items.filter((i) => i !== text) } : b
    );
    setBuckets(updated);
    setUncategorized((prev) => [text, ...prev]);
    await saveBuckets(updated);
    await showToast({ style: Toast.Style.Success, title: "Moved back to Recent" });
  }

  function openBucket(bucket: Bucket) {
    push(
      <BucketItemsView
        bucket={bucket}
        onRemove={(text) => removeFromBucket(text, bucket.id)}
      />
    );
  }

  function getMoveActions(text: string) {
    const namedBuckets = buckets.filter((b) => b.name);
    const nextEmptyBucket = buckets.find((b) => !b.name);

    return [
      ...namedBuckets.map((bucket) => (
        <Action
          key={bucket.id}
          title={bucket.name}
          icon={Icon.Folder}
          onAction={() => moveToExistingBucket(text, bucket.id)}
        />
      )),
      nextEmptyBucket ? (
        <Action
          key="new"
          title="New Bucket"
          icon={Icon.FolderAdd}
          onAction={() =>
            push(
              <BucketNameForm onSubmit={(name) => moveToNewBucket(text, nextEmptyBucket.id, name)} />
            )
          }
        />
      ) : null,
    ];
  }

  function getBulkMoveActions() {
    const namedBuckets = buckets.filter((b) => b.name);
    const nextEmptyBucket = buckets.find((b) => !b.name);
    const count = selectedItems.size;

    return [
      ...namedBuckets.map((bucket) => (
        <Action
          key={bucket.id}
          title={bucket.name}
          icon={Icon.Folder}
          onAction={() => moveBulkToExistingBucket(bucket.id)}
        />
      )),
      nextEmptyBucket ? (
        <Action
          key="new"
          title="New Bucket"
          icon={Icon.FolderAdd}
          onAction={() =>
            push(
              <BucketNameForm
                onSubmit={(name) => moveBulkToNewBucket(nextEmptyBucket.id, name)}
              />
            )
          }
        />
      ) : null,
    ];
  }

  function clipboardItemActions(text: string) {
    const isSelected = selectedItems.has(text);
    const hasSelections = selectedItems.size > 0;

    return (
      <ActionPanel>
        <Action
          title={isSelected ? "Deselect" : "Select"}
          icon={isSelected ? Icon.CheckCircle : Icon.Circle}
          shortcut={{ modifiers: ["opt"], key: "space" }}
          onAction={() => toggleSelection(text)}
        />
        {hasSelections && (
          <ActionPanel.Submenu
            title={`Move ${selectedItems.size} Selected to Bucket`}
            icon={Icon.Folder}
          >
            {getBulkMoveActions()}
          </ActionPanel.Submenu>
        )}
        <ActionPanel.Submenu title="Move to Bucket" icon={Icon.Folder}>
          {getMoveActions(text)}
        </ActionPanel.Submenu>
        <Action
          title="Paste"
          icon={Icon.Clipboard}
          onAction={async () => {
            await Clipboard.paste(text);
            await showToast({ style: Toast.Style.Success, title: "Pasted" });
          }}
        />
        <Action
          title="Copy"
          icon={Icon.CopyClipboard}
          onAction={async () => {
            await Clipboard.copy(text);
            await showToast({ style: Toast.Style.Success, title: "Copied" });
          }}
        />
      </ActionPanel>
    );
  }

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search..." isShowingDetail>
      <List.Section title="Latest Copied">
        {uncategorized.length === 0 && !isLoading && (
          <List.Item id="empty-recent" title="No uncategorized items" icon={Icon.CheckCircle} />
        )}
        {uncategorized.slice(0, 1).map((text, i) => (
          <List.Item
            key={`uncategorized-${i}`}
            id={`uncategorized-${i}`}
            icon={selectedItems.has(text) ? Icon.CheckCircle : Icon.Clipboard}
            title={truncate(text)}
            detail={<List.Item.Detail markdown={text} />}
            actions={clipboardItemActions(text)}
          />
        ))}
      </List.Section>

      <List.Section title="Buckets">
        {buckets
          .filter((b) => b.items.length > 0)
          .map((bucket) => (
            <List.Item
              key={`bucket-${bucket.id}`}
              id={`bucket-${bucket.id}`}
              icon={Icon.Folder}
              title={bucket.name}
              subtitle={`${bucket.items.length} item${bucket.items.length !== 1 ? "s" : ""}`}
              keywords={bucket.items.map((t) => t.replace(/\n/g, " ").trim())}
              detail={<List.Item.Detail markdown={bucketMarkdown(bucket)} />}
              actions={
                <ActionPanel>
                  <Action
                    title="Open Bucket"
                    icon={Icon.ArrowRight}
                    onAction={() => openBucket(bucket)}
                  />
                  <Action
                    title="Rename Bucket"
                    icon={Icon.Pencil}
                    onAction={() =>
                      push(
                        <BucketNameForm
                          initialName={bucket.name}
                          onSubmit={(name) => renameBucket(bucket.id, name)}
                        />
                      )
                    }
                  />
                </ActionPanel>
              }
            />
          ))}
      </List.Section>

      {uncategorized.length > 1 && (
        <List.Section title="Everything Else">
          {uncategorized.slice(1).map((text, i) => (
            <List.Item
              key={`older-${i}`}
              id={`older-${i}`}
              icon={selectedItems.has(text) ? Icon.CheckCircle : Icon.Clipboard}
              title={truncate(text)}
              subtitle={`${i + 1} ago`}
              detail={<List.Item.Detail markdown={text} />}
              actions={clipboardItemActions(text)}
            />
          ))}
        </List.Section>
      )}
    </List>
  );
}
