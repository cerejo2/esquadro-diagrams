package library.catalog;

public record Author(String name, String country) {
    public String initials() {
        StringBuilder sb = new StringBuilder();
        for (String part : name.split(" ")) {
            if (!part.isEmpty()) sb.append(part.charAt(0));
        }
        return sb.toString();
    }
}
