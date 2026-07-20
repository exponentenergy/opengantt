import { useRoute } from "./lib/router";
import { Home } from "./views/Home";
import { ImportWizard } from "./views/ImportWizard";
import { Editor } from "./views/Editor";

export default function App() {
  const route = useRoute();
  return (
    <div className="og-app">
      {route.ganttName ? (
        <Editor key={route.ganttName} ganttName={route.ganttName} />
      ) : route.importing ? (
        <ImportWizard />
      ) : (
        <Home />
      )}
    </div>
  );
}
