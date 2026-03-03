import { FolderSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type PathFieldProps = {
  id: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onBrowse: () => void;
  browseLabel: string;
};

export function PathField({
  id,
  value,
  placeholder,
  onChange,
  onBrowse,
  browseLabel,
}: PathFieldProps) {
  return (
    <div className="path-row">
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={placeholder}
      />
      <Button
        type="button"
        variant="ghost"
        icon={<FolderSearch size={15} />}
        className="cc-action-btn"
        onClick={onBrowse}
      >
        {browseLabel}
      </Button>
    </div>
  );
}
